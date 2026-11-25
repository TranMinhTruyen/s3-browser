# Архитектура S3Browser

[English](ARCHITECTURE.md) | [Tiếng Việt](ARCHITECTURE.vi.md) | [日本語](ARCHITECTURE.ja.md) | [简体中文](ARCHITECTURE.zh-CN.md) | [繁體中文](ARCHITECTURE.zh-TW.md) | [Русский](ARCHITECTURE.ru.md) | [Deutsch](ARCHITECTURE.de.md)

Краткий обзор кода для новых разработчиков. Соглашения описаны в `CLAUDE.md`; этот файл объясняет, как части связаны между собой.

## 1. Стек

- Настольное приложение на **Wails v3**: бэкенд на Go + фронтенд на React 19 / TypeScript в WebView. Только для Windows.
- Бэкенд: AWS SDK v2 (S3), `madmin-go` (администрирование MinIO), SQLite (modernc) + миграции goose + sqlc, `slog`.
- Нативная библиотека БД: `s3b_db.dll` на **Rust** (tokio + по одному низкоуровневому драйверу на каждую БД), Go загружает её **без cgo**. Она выполняет всю работу режима SQL с базами данных пользователя (раздел 2.11).
- Фронтенд: Mantine 9, zustand 5 + immer, NiceModal, i18next (7 языков: en / vi / ja / zh-CN / zh-TW / ru / de), sonner (toast), `@tanstack/react-virtual`, zod, dayjs. Менеджер пакетов: **bun**.

```
s3-browser
├── main.go                 точка входа: logger, Wails app, сервисы, главное окно
├── internal/
│   ├── app.go              создаёт БД, модули и обработчики; Shutdown
│   ├── handlers/           тонкие сервисы Wails (привязаны к фронтенду)
│   ├── modules/
│   │   ├── global/         общий контейнер подключений и кэш доступа
│   │   ├── profile/        профили подключения (секреты зашифрованы)
│   │   ├── master/         справочные данные (регионы...)
│   │   ├── bucket/         подключение, бакеты, политика бакета, объекты, загрузка, скачивание, поиск
│   │   ├── db/             режим SQL: профили БД, подключения, запросы -> вызывает s3b_db.dll
│   │   ├── setting/        настройки приложения (settings.json), запомненные вкладки (tabs.json), автозапуск
│   │   └── update/         самообновление из GitHub Releases
│   └── pkg/                cnst, db (schemas, queries, sqlc), logger, memprobe, portable, utils
├── models/                 модели ввода/вывода + alias.go
├── rust/                   Cargo workspace для s3b_db.dll: src/{ffi,dispatch,registry,runtime}.rs, protocol/, drivers/, tests/
├── frontend/
│   ├── bindings/           СГЕНЕРИРОВАННЫЕ привязки Wails (не редактировать)
│   └── src/                common, components, pages (pages/s3, pages/sql), locales, test
├── build/                  упаковка для платформ (Windows NSIS, portable, ...) и Taskfile (build:dll, copy:dll)
├── test-env/               тестовые серверы в Docker (MinIO, Keycloak, LDAP, 6 баз данных), скрипты замеров
└── docs/                   эта документация + инструменты для PDF
```

## 2. Бэкенд

### 2.1 Слои

```mermaid
flowchart LR
  main[main.go] --> app[internal/app.go]
  app --> H[handlers]
  H --> M[modules/*/module.go]
  M --> S[submodule_*_mng.go]
  S --> G[(modules/global)]
  S --> DB[(SQLite via sqlc)]
  S --> S3[(S3 / MinIO)]
  S --> DLL[[s3b_db.dll - Rust]]
  DLL --> UDB[(user databases)]
```

- `main.go` создаёт logger и приложение Wails, регистрирует шесть обработчиков (bucket, db, master, profile, setting, update) через `application.NewService` и создаёт главное окно (`EnableFileDrop: true`).
- `internal/app.go` (`NewApp`) открывает базу данных и применяет миграции, создаёт `KeyManager` (шифрование секретов), собирает модули, а поверх них обработчики. `Shutdown` отменяет передачи, отключает все подключения и закрывает БД.
- **Обработчики** (`internal/handlers/*_handler.go`) тонкие: они только вызывают модуль. Их публичные методы становятся привязками TypeScript.
- **Модули** (`internal/modules/<name>/module.go`) предоставляют публичный API с doc-комментариями. Работа разделена на неэкспортируемые подмодули (`submoduleXxxMng`, конструктор `newSubmoduleXxxMng`) в `submodule_<x>_mng.go`.

### 2.2 Вывод и коды сообщений

Каждый обработчик возвращает `models.Output[T]` (`Result`, `MessageList`, `Body`).

```go
output := models.NewOutput[T]()
output.AddMessage(msg)             // Result остаётся true
return output.ThrowError(msg)      // Result = false + сообщение
```

- Сообщение создаётся через `models.NewMessage` / `models.NewParamsMessage(type, module, CODE, errorDetail, params)`. Типы: `S` успех, `E` ошибка, `W` предупреждение, `I` информация (`internal/pkg/cnst`).
- Коды — это `var` в начале каждого `module.go`, формат `<PREFIX><S|E|W><NNN>` (`S3E006`, `PFE001`, `MTE001`, `UPE004`).
- Фронтенд переводит сообщение по ключу `ipcMessage:<moduleName>.<CODE>`, поэтому **для каждого нового кода нужен ключ в `frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/messages/ipcMessage.json`**.
- Новые модели размещаются в `models/<domain>/` (`*_input.go`, `*_output.go`, json-теги в camelCase) и должны быть реэкспортированы в `models/alias.go`.

### 2.3 Контейнер подключений и кэш доступа (`modules/global`)

`global.Module` хранит `connContainer` — `map[id]*S3Conn`, защищённый `sync.RWMutex`. `S3Conn` объединяет клиент S3, presign-клиент, необязательный административный клиент MinIO, `http.Transport` и учётные данные (`Creds`, `CredInfo`). `profile` регистрирует подключения, `bucket` читает их (`GetConnContainer`). `RemoveConn` / `ReplaceConn` возвращают старое подключение и **никогда его не закрывают**: закрытие выполняет вызывающий код после снятия блокировки, потому что закрытие требует сетевого ввода-вывода.

У каждого подключения также есть `AccessCache` (`access_cache.go`): по имени бакета он запоминает, отклонён ли доступ на чтение, запись и удаление, а также режим политики бакета, показываемый в виде бейджа. Записи истекают через `accessTTL` (5 минут). `Reset` увеличивает generation, поэтому проверка, начатая до сброса (со старыми учётными данными), не может записать результат. Список бакетов использует кэш, чтобы помечать недоступные / доступные только для чтения бакеты, не проверяя каждый бакет заново.

### 2.4 Контекст и отмена

- Обработчики, принимающие `ctx`, получают контекст вызова Wails: он завершается, когда фронтенд отменяет вызов, но не связан со временем жизни приложения.
- `withCallContext(ctx, appCtx, timeout)` (`modules/bucket/call_helper.go`) создаёт контекст для одного вызова: он останавливается при отмене фронтендом, при завершении приложения (`context.AfterFunc`) и по тайм-ауту. Всегда вызывайте `defer` для возвращаемой функции cancel.
- `isCallCanceled(ctx)`: отменённый вызов **молча** возвращает `Result=false` (никто не ждёт); тайм-аут по-прежнему сообщается.
- Параллелизм использует `errgroup` с `SetLimit`. Код внутри `g.Go` не должен паниковать: Wails не перехватывает паники дополнительных горутин.

### 2.5 События

События от бэкенда к фронтенду — это константы в `modules/<x>/events.go` с именами вида `domain:kebab-name`, например `uploader:upload-progress-batch`, `downloader:download-progress-batch`, `uploader:files-dropped`, `bucket:credential-expiring` и `update:state-changed`. Они регистрируются в `init()` через `application.RegisterEvent[PayloadType](name)`; вызов должен идти прямо из `init`, чтобы генератор привязок создал тип полезной нагрузки. События прогресса группируются: один общий тикер на 200 мс (`utils.BatchReporter`) отправляет одно событие с прогрессом всех выполняющихся задач (`{items: [...]}`). Перетащенные файлы приходят из `main.go` (`WindowFilesDropped` -> `BucketHandler.FilesDropped`) и повторно отправляются как `uploader:files-dropped` / `uploader:picker-files-dropped`.

### 2.6 База данных

Файл SQLite `data.db` находится в каталоге данных приложения (см. `internal/pkg/portable`; WAL, внешние ключи включены, резервная копия при запуске).

- Миграции: goose, `internal/pkg/db/schemas/NNNNNN_name.sql`, выполняются `db.RunMigrations`.
- Запросы: `internal/pkg/db/queries/<domain>/<snake_name>.sql` с `-- name: PascalName :one|many|exec`; в SQL запятые ставятся в начале строки.
- Код: `go tool sqlc generate` пишет в `internal/pkg/db/sqlc` (генерируется, не редактировать).

### 2.7 Настройки приложения и запомненные вкладки (`modules/setting`)

Тема, шрифт, язык, запуск при старте системы и параметры обновления (`autoUpdate`, `betaUpdate`) хранятся в `settings.json` в том же каталоге данных, что и `data.db` (не в SQLite).

- `GetSettings`, `SaveSettings`, `ResetSettings` (`SettingHandler`). Значения проверяются по фиксированным спискам (`languages` в `submodule_setting_mng.go` содержит 7 кодов языков); при отсутствии или повреждении файла используются значения по умолчанию (`light`, `nunito`, `en`, автообновление включено), неизвестное значение сбрасывает только своё поле.
- Запись атомарная (временный файл + rename) под мьютексом. `ResetSettings` лишь возвращает значения по умолчанию; ничего не записывается до Save.
- После успешного `SaveSettings` обработчик передаёт `betaUpdate` и `autoUpdate` в `update.Module` (`SetBeta`, `SetAutoUpdate`).
- Запуск при старте системы пишет в `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (`autostart_windows.go`). Он не поддерживается в портативной сборке и в других ОС (`autostartSupported=false`). Save сначала пишет файл, затем реестр; если запись в реестр не удалась, в файле остаётся старое значение и возвращается предупреждение `STE003`.
- `main.go` один раз читает тему, чтобы задать цвет фона окна до загрузки страницы.
- Запомненные вкладки: `GetTabState` / `SaveTabState` (`SettingHandler`) читают и пишут `tabs.json` (`submodule_tab_mng.go`): порядок вкладок, активную вкладку и профиль каждой вкладки. Отсутствующий, повреждённый или недопустимый файл даёт пустое состояние.

### 2.8 Аутентификация и подключения (`modules/profile`, `modules/bucket`)

У профиля есть `provider` (`aws` или `minio`) и `authType` (`internal/pkg/cnst/auth.go`). `cnst.IsAuthTypeValid` проверяет эту пару; список должен совпадать с CHECK миграции `000002_auth_methods.sql` и с `authMethods.ts` во фронтенде.

| Провайдер | Типы аутентификации |
|---|---|
| `aws` | `static`, `sharedProfile`, `assumeRole`, `sso`, `defaultChain`, `anonymous` |
| `minio` | `static`, `minioAssumeRole`, `minioLdap`, `minioOidc`, `minioCert`, `anonymous` |

- Профили хранятся в SQLite: несекретные параметры — в JSON-столбце (`auth_config`), секреты шифруются через `KeyManager` (`auth_secret`).
- `buildCredentials` (`submodule_cfg_credentials.go`) определяет учётные данные для типа аутентификации и **получает их один раз**, поэтому неверный профиль, истёкшая сессия SSO или отклонённая роль приводят к ошибке при подключении со своим сообщением (`S3E030` - `S3E038`, `PFE009`), а не при первом запросе.
  - Типы на основе AWS CLI (`sharedProfile`, `sso`, `assumeRole`, `defaultChain`) используют конфигурационные файлы SDK. `assumeRole` с серийным номером MFA использует одноразовый код только один раз, поэтому без нового кода обновление невозможно.
  - `minioAssumeRole` (ключ доступа + секретный ключ) и `minioLdap` (пользователь + пароль LDAP) обращаются к конечной точке STS MinIO (это конечная точка S3). Учётные данные **обновляются сами** до истечения срока, потому что секреты остаются в памяти внутри провайдера (никогда не логируются).
  - `minioCert` обращается к STS MinIO с клиентским TLS-сертификатом (mTLS, `AssumeRoleWithCertificate`, нужен https). Ключ PEM может быть зашифрован по PKCS#8 (`submodule_cert_loader.go`).
  - `minioOidc` обменивает токены входа через OpenID Connect на учётные данные MinIO (`AssumeRoleWithWebIdentity`).
  - `anonymous` отправляет неподписанные запросы; бакеты должен ввести пользователь, потому что анонимный клиент не может получить список бакетов.
- **OIDC** (`submodule_oidc_login.go`): поток authorization code с **PKCE**, только публичный клиент. Системный браузер открывает страницу IdP, локальный сервер на `127.0.0.1` принимает перенаправление и сразу останавливается. Вход ограничен 5 минутами (`oidcLoginTimeout`). Сессия (токены) хранится **только в памяти бэкенда**, переиспользуется не дольше 10 минут (`oidcSessionTTL`, а также не дольше срока действия токена) и применяется один раз за подключение; фронтенд хранит только `sessionId` и никогда не видит токен. Если сессия уже использована, нужен новый вход (`S3E030`). Профили OIDC никогда не подключаются автоматически (`cnst.IsAutoConnectAllowed`), как и профили `assumeRole` с серийным номером MFA.
- **Безопасность URL**: каждый URL, полученный от IdP (issuer, конечные точки документа discovery), должен пройти `utils.IsSecureUrl` (`internal/pkg/utils/url.go`): `https` или `http` только для loopback-хоста. Форма профиля проверяется так же (`profile/submodule_auth_mng.go`).
- **Собственный CA**: любой тип аутентификации MinIO может добавить файл CA (`AuthConfig.CaFile`). `newTransport` добавляет его в системный пул (`S3E049`, если загрузить не удалось), и он применяется только к транспорту MinIO (S3 и STS); к IdP обращение идёт с хранилищем доверия ОС. `newTransport` всегда задаёт `TLSClientConfig`, потому что minio-go пишет в него при mTLS. `ChooseAuthFile` открывает системный диалог для файлов сертификата, ключа и CA; отмена диалога не является ошибкой (`utils.IsDialogCancelled`).
- **Повторная аутентификация**: `ReauthConnection` обновляет учётные данные живого подключения, не разрывая его (провайдер за `SwapCreds` заменяется, `madmin` читает через тот же провайдер), поэтому текущие передачи продолжаются. Секреты, которые профиль не сохраняет (`mfaCode`, `secretKey`, `ldapPassword`), передаются фронтендом только для этого вызова.
- **Предупреждение об истечении**: когда учётные данные нельзя обновить без пользователя (`CredInfo.Refreshable=false`), бэкенд до истечения срока отправляет `bucket:credential-expiring` (`CredentialExpiringOutput`); фронтенд (`useCredentialExpiring`) показывает toast.

### 2.9 Управление бакетами и политика бакета (`modules/bucket`)

- `CreateBucket`, `GetBucketDetail`, `GetBucketDeleteInfo`, `DeleteBucket`, `GetBucketPolicy`, `PutBucketPolicy` и `CheckBucketAccess` находятся в `module.go`; работа выполняется в `submodule_bucket_mng.go`, `submodule_bucket_detail.go`, `submodule_bucket_delete.go`, `submodule_bucket_edit_mng.go` и `submodule_bucket_policy.go`.
- **Режимы доступа** бакета: `private` (без политики), `public` только чтение (`GetObject`, `ListBucket`, `GetBucketLocation` для `*`) и `custom` (JSON). ACL нет. Политики сравниваются по смыслу (`samePolicy`), потому что MinIO возвращает нормализованную политику. В настоящем AWS запросы политик идут в регион бакета (`policyOptFns`), а Block Public Access только читается и показывается как предупреждение (`S3E058` при сохранении публичной политики, которую он блокирует).
- При создании бакета режим доступа можно задать в том же вызове. Если бакет создан, а политику задать не удалось, бакет сохраняется, `Result` остаётся true и возвращается предупреждение (`S3W011` или `S3W012` для Block Public Access).
- **Бейдж**: список бакетов показывает режим политики каждого бакета (`PolicyBadge`). `GetListBucket` заполняет `PolicyMode` из `AccessCache`, параллельно читает недостающие и кэширует только однозначные ответы (`isSurePolicyError`), поэтому тайм-аут повторяется. Анонимные подключения пропускаются.
- **Удаление**: пользователь вводит имя бакета. Непустой бакет сначала очищается (все версии и маркеры удаления через общий `batchDeleter`), затем выполняется `DeleteBucket` (тайм-аут 30 минут). Непустой бакет с Object Lock отклоняется до удаления любого объекта (`S3E063`). Нет события прогресса и кнопки отмены; закрытие приложения молча останавливает удаление. Пункт меню «Удалить» скрывается только тогда, когда точно известно, что учётной записи отказано в `s3:DeleteBucket` (`AccessDelete`).
- Анонимные подключения не могут создавать, изменять или удалять бакеты (`S3E054`), но могут открыть панель сведений.

### 2.10 Автообновление (`modules/update`)

`update.Module` проверяет **GitHub Releases** репозитория `TranMinhTruyen/s3-browser` на наличие новой версии, скачивает установщик NSIS и запускает его. `UpdateHandler` предоставляет `GetUpdateState`, `CheckUpdate`, `DownloadUpdate` и `InstallUpdate`.

- **Поддерживаемые сборки**: только сборка Windows, установленная установщиком NSIS (он записывает `uninstall.exe` рядом с exe; `installSupported`). Портативные и распакованные сборки, а также другие ОС не поддерживаются, и фронтенд скрывает функцию (`supported=false`). В режиме dev она всегда включена для тестирования. Версия берётся из `build/config.yml` (встроен в `main.go`).
- **Каналы**: один провайдер GitHub только для стабильных релизов и один, включающий пре-релизы; параметр `betaUpdate` выбирает канал (`SetBeta`). При включённой бете учитывается только более новый пре-релиз.
- **Проверка**: `CheckUpdate` выполняется по запросу пользователя. Когда `autoUpdate` включено, цикл проверяет через 10 секунд после запуска, а затем каждые 6 часов (`checkInterval`), и новый релиз начинает скачиваться сам; сбои цикла только записываются в лог.
- **Контрольная сумма**: ресурс релиза `checksums.txt` должен содержать SHA-256 установщика `S3Browser-<version>-windows-<arch>-installer.exe`. Хэш считается во время скачивания во временный каталог, и файл удаляется, если хэш не совпал (`UPE004`). `InstallUpdate` проверяет его ещё раз перед запуском, потому что во временный каталог могут писать другие программы. Скачивание идёт только с хостов GitHub.
- **Установка**: установщик запускается тихо через `ShellExecute` (запрос UAC, `/S /relaunch /D=<каталог установки>`), затем приложение завершается, а установщик запускает новую версию. Если установщик запустить не удалось, приложение продолжает работать (`UPE005`). Скачанный установщик удаляется после следующего запуска.
- **Состояние**: `UpdateStateOutput` (`supported`, `state`, `currentVersion`, `version`, `releaseUrl`, `written`, `total`, `errorCode` — код `UPE...` при `state` = `error`). `state` — это `idle`, `checking`, `upToDate`, `available`, `downloading`, `ready` или `error`. Каждое изменение, а во время скачивания — каждые 200 мс, отправляется событием `update:state-changed`.
- **Сообщения**: `UPS001` (последняя версия), `UPE001` (не удалось проверить), `UPE002` (ограничение запросов GitHub), `UPE003` (не удалось скачать), `UPE004` (контрольная сумма), `UPE005` (не удалось запустить установщик), `UPE006` (нет установщика для этого компьютера).

### 2.11 Режим SQL: как Go вызывает Rust (`modules/db` -> `s3b_db.dll`)

**Всю работу с базой данных, к которой подключается пользователь, выполняет Rust**: открытие подключения, выполнение SQL, разбиение на операторы, дерево объектов, постраничная выдача, преобразование значений и отмена. Go служит только мостом: проверяет входные данные, отправляет запрос, превращает ошибки в сообщения и передаёт результат дальше. Фронтенд не знает о существовании Rust и вызывает `DbHandler`, как любую другую привязку. Собственная SQLite приложения (профили, настройки) по-прежнему обрабатывается в Go.

```mermaid
sequenceDiagram
  participant FE as React (callIPC)
  participant M as DbHandler + modules/db
  participant N as submoduleNativeMng
  participant F as ffi.rs
  participant D as dispatch.rs
  participant A as driver actor
  FE->>M: ExecuteSql(input) (binding)
  M->>N: callNativeRaw(ctx, "execute", params)
  N->>F: s3b_call(request JSON), syscall without cgo
  F->>D: dispatch::call (tokio, block_on)
  D->>A: Cmd::Execute (mpsc channel)
  A-->>D: ExecuteResult (oneshot channel)
  D-->>F: {"ok":true,"result":{...}}
  F-->>N: out_ptr / out_len (Rust buffer)
  N->>F: s3b_free(ptr, len) after copying
  N-->>M: result bytes, not decoded
  M-->>FE: Output.Body = the same JSON
```

**Загрузка DLL** (`internal/modules/db/native_windows.go`)

- Приложение собирается с `CGO_ENABLED=0`. Go загружает DLL через `golang.org/x/sys/windows`: `LoadLibraryEx(<папка exe>\s3b_db.dll, LOAD_LIBRARY_SEARCH_APPLICATION_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32)`. Путь абсолютный, поэтому ни одна папка из пути поиска не может подменить DLL.
- `GetProcAddress` находит четыре экспортируемые функции, затем один раз выполняется `s3b_init`. Все вызовы проходят через `syscall.SyscallN`.
- DLL загружается при первом вызове (обычно Connect), а не при запуске приложения. При неудачной загрузке следующий вызов пробует снова, а ошибка сообщается как `DBE009`. В других ОС `native_other.go` просто возвращает ошибку.
- DLL собирается с `+crt-static` (`rust/.cargo/config.toml`), поэтому ей не нужна `VCRUNTIME140.dll`.

**Контракт FFI** (`rust/src/ffi.rs`)

| Экспорт | Сигнатура | Назначение |
|---|---|---|
| `s3b_init` | `() -> i32` | Создаёт единственный runtime tokio и провайдер TLS. |
| `s3b_call` | `(req_ptr, req_len, *out_ptr, *out_len) -> i32` | Один JSON-запрос; блокируется, пока не готов JSON-ответ, и возвращает буфер, которым владеет Rust. |
| `s3b_cancel` | `(id: u64)` | Просит прервать запрос `id`. |
| `s3b_free` | `(ptr, len)` | Освобождает буфер, возвращённый `s3b_call`. |

- Возвращаемое значение сообщает только о сбое самого вызова: `0` успех, `1` неверный аргумент, `2` ошибка инициализации, `-1` panic. Ошибки самой работы (неверный SQL, закрытое подключение...) возвращаются внутри JSON.
- Каждая экспортируемая функция обёрнута в `catch_unwind`, а профиль release сохраняет `panic = "unwind"`, поэтому panic в Rust никогда не попадает в Go. Вне тестов `unwrap`/`expect` не используются.
- Память: Rust копирует запрос и после возврата не хранит указателей на память Go. Go копирует ответ и всегда вызывает `s3b_free`: буфер, выделенный Rust, освобождает только Rust.

**Протокол** (`rust/src/protocol/mod.rs`, JSON в camelCase)

```jsonc
// запрос: id уникален для каждого вызова (атомарный счётчик в Go) и служит ключом для s3b_cancel
{"id": 7, "method": "execute", "params": {"connId": 1, "sql": "select 1", "pageSize": 10000, "maxPageBytes": 16777216}}
// успех
{"ok": true, "result": {...}}
// ошибка
{"ok": false, "error": {"code": "sqlError", "message": "no such table: t"}}
```

- Методы: `open`, `close`, `execute`, `fetch`, `schemaTree`, `tableInfo`, `tableRows`.
- Коды ошибок стабильны; `errorCodeMessage` (`submodule_native_mng.go`) превращает их в сообщения: `invalidRequest` `DBE001`, `openFailed` `DBE002`, `notADatabase` `DBE003`, `connNotFound` `DBE004`, `cursorNotFound` `DBE005`, `sqlError` `DBE006` (показывается вместе с оператором, а не всплывающим уведомлением), `tableNotFound` `DBE007`, любой другой код `DBE008`. `cancelled` молча возвращает `Result=false`. Ошибка загрузки — `DBE009`, тайм-аут на стороне Go — `DBE015`. Для новых кодов нужны ключи во всех 7 файлах `ipcMessage.json`.

**Внутри Rust**: `ffi.rs` -> `dispatch.rs` -> `drivers/<db>/`

- `dispatch::call` запускает каждый запрос как задачу в единственном многопоточном runtime tokio (`runtime.rs`) и ждёт её через `block_on`, потому что для Go функция `s3b_call` синхронная. Panic внутри задачи превращается в ошибку `internal`.
- `dispatch` разбирает запрос и направляет его по `method`. Ошибки разбора никогда не повторяют неверное значение, поэтому пароль не может попасть в сообщение.
- Каждое подключение — это **актор**: одна задача tokio, которая единолично владеет подключением. Она получает команды (`Cmd::Execute`, `Fetch`, `TableRows`, `SchemaTree`, `TableInfo`, `Close`) по каналу `mpsc` и отвечает по каналу `oneshot`, поэтому блокировка вокруг подключения не нужна (как goroutine с channel в Go).
- `registry.rs` сопоставляет `connId` с каналом актора, а `id` запроса — с его подключением и `CancelSignal`.
- Для каждой БД используется самый низкоуровневый драйвер, который пишет строки сразу в текст JSON с заранее выделенной ёмкостью:

| База данных | Драйвер Rust |
|---|---|
| SQLite | `libsqlite3-sys` (C API, bundled); `sqlx` только для открытия подключения |
| PostgreSQL | `tokio-postgres` |
| MySQL / MariaDB | `mysql_async` |
| SQL Server | `tiberius` |
| MongoDB | `mongodb` (сырой BSON) |
| Redis | `redis` |

**Go не декодирует результаты**

`callNativeRaw` проверяет, что ответ начинается с `{"ok":true,"result":`, и вырезает байты результата без разбора. `StatementResult`, `ExecuteSqlOutput` и `FetchRowsOutput` (`models/db`) хранят эти байты, а их `MarshalJSON` (`query_output_json.go`, тег сборки `!wailsgen`) записывает их в ответ Wails без изменений, поэтому страница из 10 000 строк никогда не декодируется и не кодируется заново. Генератор привязок превращает тип с `MarshalJSON` в `any`, поэтому привязки генерируются с `-tags=wailsgen` (раздел 4). Небольшие результаты (`open`, `schemaTree`, `tableInfo`) декодируются обычным образом через `callNative[T]`.

**Отмена и тайм-ауты**

- Контекст Go для вызова завершается, когда фронтенд прерывает вызов (`AbortController`), когда приложение закрывается или по тайм-ауту: 5 минут для `ExecuteSql`, `OpenTableRows` и `FetchRows` (`queryTimeout`), 30 секунд на подключение и чтение метаданных (`metaTimeout`). У `FetchRows` с `All` нет ни ограничения страницы, ни тайм-аута.
- Когда контекст завершается, горутина в `callNativeRaw` вызывает `s3b_cancel(id)` каждые 100 мс, пока `s3b_call` не вернётся, потому что первая отмена может прийти раньше, чем Rust зарегистрирует запрос.
- Rust выставляет `CancelSignal`, прерывает выполняемый оператор и отвечает `cancelled`. Go молча возвращает `Result=false`, если отменил фронтенд, и `DBE015` при тайм-ауте.

**Подключения и постраничная выдача**

- У каждого профиля есть одно **основное подключение** (`ConnectDb`) для дерева объектов и сведений о таблицах и **отдельное подключение для каждой вкладки SQL**, которое открывается при первом запуске в этой вкладке. `CloseDbTab` закрывает подключение вкладки, `DisconnectDb` — все подключения профиля, а `Close` (при закрытии приложения) — все сразу.
- Результаты выдаются постранично: первая и каждая следующая страница содержат не более 10 000 строк или 16 МиБ (`pageSize`, `maxPageBytes`). Остальное хранится в курсоре на стороне Rust (`cursorId`); весь результат никогда не читается в память.

**Текущее состояние**

- В Rust есть драйверы для SQLite, PostgreSQL, MySQL, MariaDB, SQL Server, MongoDB и Redis, проверенные на реальных серверах.
- Пока Go открывает только **SQLite** (`openParams{"sqlite", path, readOnly}` в `submodule_conn_mng.go`).
- Профили PostgreSQL можно сохранять (`db_profiles`), но подключение, дерево объектов и строки для них во фронтенде пока заглушки (`frontend/src/pages/sql/mock`). Других сетевых БД в интерфейсе пока нет.

**Добавление новой возможности**

1. Rust: типы параметров и результата в `protocol`, ветка в `dispatch::route`, вариант `Cmd`, реализация в каждом драйвере, тесты через `cargo test`.
2. Go: структура параметров и вызов через `callNative[T]` (небольшой результат) или `callNativeRaw` (строки), новые коды ошибок, сопоставленные с `DBE...`, с ключами на 7 языках, затем метод модуля, обработчик и заново сгенерированные привязки.
3. Никогда не делайте эту работу в Go ради упрощения: Go остаётся мостом.

## 3. Фронтенд

### 3.1 Вызов бэкенда: `callIPC`

Все вызовы бэкенда идут через `callIPC` (`frontend/src/common/utils/ipcUtils.ts`), а не напрямую через привязку:

```ts
const body = await callIPC(GetListObject, [input], { scope: `${SCOPE}/load`, signal });
```

- Показывает сообщения `Output` как toast (`showMessage`, по умолчанию включено) по ключу `ipcMessage:<module>.<CODE>`.
- Возвращает `body` при успехе и `null` при ошибке, отмене или устаревшем результате.
- `scope`: более новый вызов с тем же scope приводит к отбрасыванию более старого результата. `signal` (`AbortController`) отменяет вызов, что также отменяет контекст Go.
- Привязки импортируются из `@wails/...` (`frontend/bindings`, сгенерированы).

### 3.2 Хранилища

Хранилища создаются через `createAppStore(creator, name)` (zustand + immer + devtools в dev; в dev они также доступны в `window.__stores`).

- У каждого хранилища есть `State`, `Action` и константа `SCOPE`; каждый `set` именуется: ``set(update, undefined, `${SCOPE}/actionName`)``.
- `reset()` вызывает `invalidateLoads(SCOPE)`, чтобы выполняющиеся результаты этого хранилища отбрасывались.
- Используйте узкие селекторы или `useShallow`; никогда не выбирайте объект целиком.

### 3.3 Модальные окна

Модальные окна — это компоненты NiceModal, обёрнутые `createMantineModal` (`common/utils/modalUtils.ts`), z-index управляется `modalStackStore`. Тяжёлые модальные окна загружаются по требованию в `components/modals/lazyModals.ts` (`showConnectModal`, `showHistoryModal`, `showSettingModal`), поэтому не попадают в основной бандл. Используйте обёртки из `components/buttons|inputs|modals` вместо «сырых» компонентов Mantine. Футер модального окна: «Отмена» слева, действия справа (`<Group justify="space-between" wrap="nowrap">`); основная область содержимого — в `<Paper withBorder>`.

### 3.4 i18n

`locales/i18n.ts` поддерживает **7 языков**: `en`, `vi`, `ja`, `zh-CN`, `zh-TW`, `ru`, `de` (`LANGUAGES` и собственные названия языков `LANGUAGE_LABELS` находятся в `common/cnst/settingConst.ts`). Статически импортируется только `en`; остальные загружаются динамическим `import()` (`RESOURCE_LOADERS`) через `loadLanguage` перед `changeLanguage`. У каждого языка есть `resource.ts`, регистрирующий по одному пространству имён на компонент/страницу (`locales/<lang>/components|pages|messages`). Строки интерфейса не пишутся в коде: добавляйте ключи во **все семь** языков (те же ключи и плейсхолдеры `{{x}}`, что в `en`) и регистрируйте новые пространства имён во всех семи `resource.ts`. Для CJK-языков в `getFontFamily` предусмотрены собственные запасные шрифты.

### 3.5 События

События бэкенда принимаются через `Events.On(name, handler)` из `@wailsio/runtime` внутри `useEffect`, а возвращаемая функция отписки вызывается при очистке (см. `UploaderWindow`, `DownloaderWindow`, `useFilesDroppedUpload`, `useAppUpdate`).

### 3.6 Списки и производительность

Большие списки (объекты, бакеты, загрузчик, история, списки файлов) виртуализируются через `@tanstack/react-virtual`. Списки объектов подгружаются страницами по курсору (`useObjectPaging`, первая страница `FIRST_PAGE_SIZE = 200`, следующие `NEXT_PAGE_SIZE = 1000`). Элементы списка обёрнуты в `memo`; каждая функция в компоненте обёрнута в `useCallback`; обработчики называются `on<Event><Target>` (`onClickConnect`).

### 3.7 Макет и вкладки

`App.tsx` -> `MainLayout` (переключатель режимов, окна загрузчика/скачивания) -> `S3Workspace` или `SqlWorkspace` (lazy в `MainLayout`, загружается при первом входе в режим; у каждого своя панель навигации и страница вкладок) -> `S3TabPage` (статически импортируется в `S3Workspace`, `pages/s3/S3TabPage.tsx`). `S3TabPage` содержит панель вкладок (`TabStrip` и `SortableTab` в `components/tabs`, перетаскивание через dnd-kit, перестановка с клавиатуры Ctrl+Shift+Влево/Вправо) и отображает `TabDetail`, который показывает `pages/s3/bucket` (`BucketListView`, `BucketItem`) или `pages/s3/object` (`ObjectListView`, `ObjectItem`). Общие части находятся в `pages/s3/components` (`BucketDetailDrawer`, `ObjectDetailDrawer`, `TabActionBar`, `TabBreadcrumb`). У каждого режима своя папка `pages/<mode>` (`s3`, `sql`) с подпапками вроде `stores`, `hooks`, `utils`, `modals`, `navbar`, `components` и `transfer`. Состояние S3 находится в `pages/s3/stores` (`profileStore`, `tabListStore`, `uploaderStore`, `downloaderStore`, `masterDataStore`); общее состояние приложения находится в `common/stores` (`settingStore`, `updateStore`).

**Запоминание вкладок**: `useTabPersistence` (вызывается в `App.tsx`) сохраняет порядок вкладок, активную вкладку и профиль каждой вкладки в `tabs.json` через `SaveTabState` спустя 500 мс после прекращения изменений и при `pagehide`. При запуске `restoreTabsFromDisk` (`pages/s3/utils/tabPersistence.ts`) загружает их через `GetTabState`. Если загрузка не удалась, сохранение на этот сеанс отключается, чтобы `tabs.json` никогда не был перезаписан. Вкладка, профиль которой удалён, сохраняет своё место, но теряет профиль (`normalizeTabProfiles`).

### 3.8 Режим SQL

`SqlWorkspace` (`pages/sql`) состоит из панели профилей с деревом объектов (`dbTreeStore`) и `SqlTabPage` с вкладками SQL (`sqlTabStore`): редактор CodeMirror, Run (Ctrl+E) и Cancel, Find/Replace и панель результатов (по вкладке на каждый SELECT плюс Messages, строки в виртуализированном `DataGrid`). `useSqlRunner` вызывает `ExecuteSql`, при прокрутке подгружает следующие страницы через `FetchRows` и вызывает `CloseDbTab`, когда вкладку закрывают или меняют её профиль. При открытии таблицы показываются её структура и данные (`useTableRows`, `OpenTableRows`). Профили хранятся в `dbProfileStore` (`sqlite` или `postgres`).

### 3.9 Настройки, тема и обновления

`main.tsx` ждёт `loadStartupData()` перед отрисовкой (параллельно загружает настройки и `restoreTabsFromDisk()`), поэтому тема, шрифт, язык и сохранённые вкладки готовы первыми (при ошибке используются значения по умолчанию). `settingStore` хранит `saved` (файл), `applied` (текущий сеанс, меняется через Apply) и `draft` (форма, предпросмотр на лету); закрытие окна возвращает `applied`. `applySettings` задаёт цветовую схему Mantine (`settingColorSchemeManager` в памяти, без localStorage), переменную `--mantine-font-family` и язык i18n.

`AppUpdateToast` один раз монтирует `useAppUpdate`: он загружает состояние через `GetUpdateState`, передаёт `update:state-changed` в `updateStore` и поддерживает один toast в актуальном состоянии (новая версия с кнопкой «Скачать» при выключенном автообновлении, прогресс скачивания, готово к установке). Если `supported` равно false, ничего не показывается.

Цвета: используйте `var(--mantine-color-*)` и `light-dark(<light>, <dark>)`, не задавайте hex/rgb в коде (кроме цветов, хранимых как данные, например цвета профиля).

## 4. Привязки и команды

Привязки Wails генерируются из обработчиков Go; генерируйте заново после любого изменения сигнатуры обработчика или модели:

```
go tool wails3 generate bindings -f "-tags=wailsgen" -clean=true -ts
```

Тег `wailsgen` обязателен (раздел 2.11). Задачи сборки для Windows сначала собирают библиотеку Rust (`common:build:dll`: `cargo build --release --target x86_64-pc-windows-msvc` в `rust/`), затем копируют `s3b_db.dll` рядом с exe (`common:copy:dll`). `dev`, `build`, `package` и `build:portable` делают это сами, а установщик NSIS и папка portable содержат DLL. Перед сборкой закройте запущенное приложение, иначе DLL не удастся заменить.

| Задача | Команда (из корня репозитория, если не указано иное) |
|---|---|
| Разработка | `go tool wails3 task dev` |
| Сборка | `go tool wails3 task build` |
| Пакет (установщик) | `go tool wails3 task package` |
| Портативная (Windows) | `go tool wails3 task build:portable WEBVIEW2_DIR=<папка WebView2 Fixed Version>` |
| Проверка Go | `go build ./...`, `go vet ./...`, `go tool golangci-lint run ./...` |
| sqlc | `go tool sqlc generate` |
| Проверка Rust (`rust/`) | `cargo fmt --check`, `cargo clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings` |
| Тесты Rust (`rust/`) | `cargo test`; тесты, которым нужен сервер БД, используют `test-env/docker-compose.yml` и без него пропускаются (`S3B_REQUIRE_DB=1` превращает пропуск в ошибку) |
| Проверка типов FE (`frontend/`) | `node_modules/.bin/tsc --noEmit` (`tsc.exe` в Windows) |
| Lint / формат FE | `npx oxlint <paths>`, `node_modules/.bin/biome check --write <paths>` |
| Тесты FE | `bun run test` (vitest); тесты лежат в `frontend/src/test/` по структуре `src/` |
| Тесты E2E (`frontend/`) | `bun run e2e:build`, затем `bun run e2e` (Playwright, только локально): настоящее приложение в режиме сервера вместе с DLL копируется в `frontend/e2e/.run/`; спецификации в `frontend/e2e/`; спецификациям S3 нужны `E2E_S3_ENDPOINT`, `E2E_S3_ACCESS_KEY`, `E2E_S3_SECRET_KEY`, без них они пропускаются; любое предупреждение или ошибка в консоли проваливает тест |
| PDF руководства пользователя | `bun run --cwd docs build:pdf` (или `go tool wails3 task docs:pdf`) |

Инструменты Go (wails3, sqlc, golangci-lint) объявлены в блоке `tool (...)` файла `go.mod`, поэтому отдельная установка не нужна. Для Rust нужны stable-toolchain с целью `x86_64-pc-windows-msvc` и Visual Studio Build Tools (рабочая нагрузка C++); их устанавливает `setup/setup-project.sh`. У Go нет закоммиченных модульных тестов, тесты Rust закоммичены (`rust/tests/`), а для фронтенда требуется покрытие веток и строк не менее 95% на каждый изменённый файл.
