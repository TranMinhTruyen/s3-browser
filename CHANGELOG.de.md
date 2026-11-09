# Änderungsprotokoll

[English](CHANGELOG.md) | [Tiếng Việt](CHANGELOG.vi.md) | [日本語](CHANGELOG.ja.md) | [简体中文](CHANGELOG.zh-CN.md) | [繁體中文](CHANGELOG.zh-TW.md) | [Русский](CHANGELOG.ru.md) | **Deutsch**

Alle wichtigen Änderungen an diesem Projekt werden in dieser Datei dokumentiert.
Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## [Unveröffentlicht]

## [1.0.0] - 2026-11-09

### Hinzugefügt

- Einstellungsdialog (Schaltfläche links von „Download-Verlauf“): Design (hell / dunkel / Systemvorgabe), Schriftart (Nunito, System UI, Segoe UI, Arial, Roboto, Be Vietnam Pro, Verdana, Meiryo UI, Monospace, JetBrains Mono), Sprache und Start mit Windows (nur in der installierten Windows-Version).
- Die Einstellungen werden in `settings.json` neben `data.db` gespeichert und vor dem Erscheinen der Oberfläche geladen, sodass die Sprache jetzt gemerkt wird.
- Änderungen werden sofort in der Vorschau angezeigt. **Übernehmen** behält sie bis zum Beenden der App, **Speichern** schreibt sie in die Datei, **Zurücksetzen** stellt im Formular die Standardwerte wieder her.
- Dunkles Design.
- Die Schriftarten JetBrains Mono, Roboto und Be Vietnam Pro sind enthalten.
- Tabs lassen sich per Drag-and-drop neu anordnen. Beim Beenden merkt sich die App Anzahl, Reihenfolge und Profil der geöffneten Tabs.
- Mehrere Authentifizierungsmethoden pro Verbindungsprofil, auswählbar im Verbindungsdialog:
  - AWS S3: Zugriffsschlüssel (mit optionalem Sitzungstoken), AWS-CLI-Profil, Rolle übernehmen (mit optionaler MFA), AWS SSO, Standardkette und anonymer Zugriff auf die von Ihnen eingegebenen Buckets.
  - MinIO: Zugriffsschlüssel, MinIO STS, LDAP / Active Directory, OpenID Connect (Anmeldung über den System-Browser, Autorisierungscode mit PKCE), TLS-Clientzertifikat (mTLS) und anonymer Zugriff.
  - Optionale CA-Datei für MinIO-Server, deren Zertifikat von einer privaten Zertifizierungsstelle stammt.
  - Temporäre Anmeldeinformationen werden vor dem Ablauf automatisch erneuert, und eine Warnung erscheint, wenn sie während einer Übertragung bald ablaufen.
  - Geheimnisse (einschließlich LDAP-Passwörtern und Schlüssel-Passphrasen) werden verschlüsselt gespeichert. Die OIDC-Anmeldung bleibt nur im Arbeitsspeicher; die App speichert den Token nie.
- Ein Verbindungsprofil in eine JSON-Datei exportieren (Rechtsklick auf das Profil, **Exportieren**) und mit der Schaltfläche **Verbindungsprofil importieren** importieren. Geheimnisse sind optional; wenn sie enthalten sind, werden sie mit einem Passwort verschlüsselt. Beim Import erhält ein doppelter Name eine Nummer, Dateipfade, die auf dem Computer nicht existieren oder Netzwerk-/Gerätepfade sind, werden geleert, und das Profil wird nicht verbunden.
- Bucket erstellen (AWS S3 mit Region, MinIO), optional mit Zugriffsmodus bei der Erstellung.
- Bucket-Berechtigung: privat (keine Bucket-Richtlinie), öffentlich nur Lesen oder eine benutzerdefinierte, als JSON bearbeitete Richtlinie, mit Warnung, wenn „Öffentlichen Zugriff blockieren“ eine öffentliche Richtlinie ablehnen würde.
- Seitenleiste mit Bucket-Details.
- Bucket löschen nach Eingabe seines Namens. Ein nicht leerer Bucket wird zuerst geleert, einschließlich aller Versionen und Löschmarkierungen. Ein nicht leerer Bucket mit Object Lock kann nicht gelöscht werden.
- Bucket-Zeilen zeigen ein Badge mit dem Richtlinientyp (Privat / Öffentlich / Benutzerdefiniert), das verzögert nur für die sichtbaren Zeilen geladen wird.
- Buckets, auf die nicht zugegriffen werden kann oder die für das aktuelle Konto schreibgeschützt sind, werden in der Liste markiert.
- Ergebnisdialog nach dem Löschen mehrerer Objekte mit einer Liste der nicht löschbaren Einträge.
- Update-Prüfung und Installation über GitHub Releases: eine Einstellung zum automatischen Suchen und Herunterladen von Updates, ein Fortschrittsbalken für den Download, SHA-256-Prüfung der heruntergeladenen Datei und eine Bestätigung, bevor die App zum Ausführen des Installers beendet wird. Ein Beta-Schalter ermöglicht den Empfang von Vorabversionen.
- Die Schalter für automatische Updates und Beta-Versionen in den Einstellungen wirken sofort, ohne **Speichern**. Beim Schließen der Einstellungen mit nicht gespeicherten Änderungen fragt die App nach **Zurück**, **Änderungen verwerfen** oder **Speichern**.
- Oberfläche auf Chinesisch (vereinfacht und traditionell), Russisch und Deutsch, zusätzlich zu Englisch, Vietnamesisch und Japanisch (insgesamt 7 Sprachen). Sprachen werden bei Bedarf geladen.
- Dokumentation in allen 7 Sprachen: README, Benutzerhandbuch (mit PDF), Architekturnotizen und dieses Änderungsprotokoll.

### Geändert

- Der EN-/VI-/JA-Umschalter in der Kopfzeile wurde in den Einstellungsdialog verschoben.
- Farben verwenden Design-Variablen, sodass jeder Bildschirm im hellen und im dunklen Design funktioniert. Der Verbindungsstatus eines Profils wird in Hellgrün / Hellrot angezeigt.
- Dialogschaltflächen: „Abbrechen“ steht links, Aktionen rechts (Bestätigen, Hochladen, Verlauf, Einstellungen).
- Der Fensterhintergrund folgt beim Start dem gespeicherten Design.
- Flüssigeres Scrollen in langen Objektlisten und in der Liste der Verbindungsprofile.
- Fortschrittsereignisse beim Hoch- und Herunterladen werden gebündelt, sodass die Oberfläche bei großen Übertragungen reaktionsfähig bleibt.
- Das Wechseln von Sprache oder Schriftart friert die Oberfläche nicht mehr ein, und das Tab-Layout wird nur noch bei Änderungen gespeichert.
- Benachrichtigungen verschwinden nach 10 Sekunden.
- Vor einer Migration wird die Datenbankdatei gesichert.
- Interne Bereinigung von Backend und Frontend (gemeinsame Hilfsfunktionen, Entfernen von totem Code) mit mehr Unit-Tests.

### Entfernt

- Builds für macOS und Linux. S3Browser erscheint jetzt nur noch für Windows 10/11 (x64).

### Bekannte Probleme

- Beim Löschen von Dateien oder Ordnern in einem Bucket mit Versionierung werden nur Löschmarkierungen gesetzt; ältere Versionen bleiben im Bucket. Wird der Bucket selbst gelöscht, werden alle Versionen entfernt.
- Eine öffentliche, schreibgeschützte Bucket-Richtlinie, deren Anweisungen in anderer Reihenfolge stehen (zum Beispiel von einem anderen Tool geschrieben), wird als „Benutzerdefiniert“ angezeigt.
- Pro Upload werden höchstens 50 Dateien je Ordner automatisch ausgewählt (4 große Dateien, insgesamt 1.000 Dateien); im Dateidialog gewählte Dateien zählen als ein Ordner.
- Dateigrößen werden in Einheiten von 1.024 berechnet, aber als KB / MB / GB angezeigt.

## [0.0.1-beta.1] - 2026-10-28

Erste Beta-Version.

### Hinzugefügt

- Verbindungsprofile: erstellen, bearbeiten, löschen, automatisch verbinden, mit verschlüsselten Geheimnissen.
- Verbindung zu AWS S3 und MinIO (Endpunkt, Region, Path style), mehrere Verbindungen gleichzeitig in Tabs.
- Durchsuchen von Buckets, Ordnern und Objekten mit seitenweisen Listen.
- Suche nach Buckets und Objekten mit seitenweisen Ergebnissen.
- Seitenleiste mit Objektdetails.
- Hochladen von Dateien und Ordnern über einen Auswahldialog oder per Drag-and-drop, mit Upload-Limits und Fortschrittsfenster.
- Herunterladen eines oder mehrerer Objekte in parallelen Blöcken, mit Fortschrittsfenster, Abbrechen und einem dauerhaft gespeicherten Download-Verlauf.
- Löschen von Objekten und Ordnern mit einem Bestätigungsschritt.
- Oberfläche auf Englisch, Vietnamesisch und Japanisch.
- Portable Windows-Version, die ihre Daten neben der exe speichert und ein eigenes WebView2 mitliefert.
- Dokumentation: Architekturbeschreibung und ein Benutzerhandbuch (PDF) in drei Sprachen.

### Geändert

- Schnellerer Start: Umfangreiche Dialoge werden bei Bedarf geladen, sodass der beim Start geladene Code etwa 24 % kleiner ist.
- Listen laden 20 statt 10 Einträge pro Seite, was beim Durchsuchen großer Buckets weniger Roundtrips bedeutet.
- Das Auswählen von Objekten zeichnet nicht mehr den gesamten Tab neu.
- Interne Bereinigung von Backend und Frontend (gemeinsame Hilfsfunktionen, Entfernen von totem Code und ungenutzten Abhängigkeiten) mit mehr Unit-Tests.
