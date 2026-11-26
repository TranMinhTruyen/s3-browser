Unicode true

####
## Lưu ý: các giá trị thay thế của template không hoạt động trong file này. Thay vào đó, chúng được cung cấp bằng các định nghĩa mặc định như
## bên dưới.
## Nếu chưa định nghĩa từ khóa, "wails_tools.nsh" sẽ điền giá trị từ ProjectInfo.
## Nếu đã định nghĩa tại đây, "wails_tools.nsh" sẽ không thay đổi chúng. Nhờ vậy có thể dùng project.nsi này thủ công
## bên ngoài Wails để gỡ lỗi và phát triển trình cài đặt.
##
## Khi phát triển, trước tiên hãy tạo bản build NSIS bằng Wails để điền nội dung cho "wails_tools.nsh":
## > wails build --target windows/amd64 --nsis
## Sau đó gọi makensis trên file này và chỉ định đường dẫn tới binary:
## Trình cài đặt chỉ dành cho AMD64:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app.exe
## Trình cài đặt chỉ dành cho ARM64:
## > makensis -DARG_WAILS_ARM64_BINARY=..\..\bin\app.exe
## Trình cài đặt hỗ trợ cả hai kiến trúc:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app-amd64.exe -DARG_WAILS_ARM64_BINARY=..\..\bin\app-arm64.exe
####
## Các thông tin sau được lấy từ file ProjectInfo, nhưng có thể ghi đè tại đây.
####
## !define INFO_PROJECTNAME    "MyProject" # Mặc định "{{.Name}}"
## !define INFO_COMPANYNAME    "MyCompany" # Mặc định "{{.Info.CompanyName}}"
## !define INFO_PRODUCTNAME    "MyProduct" # Mặc định "{{.Info.ProductName}}"
## !define INFO_PRODUCTVERSION "1.0.0"     # Mặc định "{{.Info.ProductVersion}}"
## !define INFO_COPYRIGHT      "Copyright" # Mặc định "{{.Info.Copyright}}"
###
## !define PRODUCT_EXECUTABLE  "Application.exe"      # Mặc định "${INFO_PROJECTNAME}.exe"
## !define UNINST_KEY_NAME     "UninstKeyInRegistry"  # Mặc định "${INFO_COMPANYNAME}${INFO_PRODUCTNAME}"
####
## !define REQUEST_EXECUTION_LEVEL "admin"            # Mặc định "admin"; xem thêm https://nsis.sourceforge.io/Docs/Chapter4.html
####
## Nạp các công cụ Wails
####
!include "wails_tools.nsh"

!insertmacro GetOptions # Từ FileFunc.nsh (được nạp trong wails_tools.nsh), đọc tùy chọn /relaunch bên dưới.

# 1 nếu ứng dụng chạy trình cài đặt này để tự cập nhật (/S /relaunch /D=<thư mục cài đặt>): chờ exe cũ
# thoát rồi khởi động lại ứng dụng khi hoàn tất. Cài đặt thủ công không truyền /relaunch và không khởi động ứng dụng.
Var Relaunch

# Phiên bản số gồm 4 phần cho VIProductVersion/VIFileVersion (INFO_PRODUCTVERSION có thể chứa hậu tố bản phát hành thử)
!define INFO_NUMERIC_VERSION "0.0.1.1"
VIProductVersion "${INFO_NUMERIC_VERSION}"
VIFileVersion    "${INFO_NUMERIC_VERSION}"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Bật hỗ trợ HiDPI. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
# !define MUI_WELCOMEFINISHPAGE_BITMAP "resources\leftimage.bmp" #Bật tùy chọn này để thêm bitmap bên trái trang chào mừng. Kích thước phải là 164x314.
!define MUI_FINISHPAGE_NOAUTOCLOSE # Chờ tại trang INSTFILES để người dùng xem chi tiết các bước cài đặt.
!define MUI_ABORTWARNING # Cảnh báo người dùng nếu họ thoát trình cài đặt.

!insertmacro MUI_PAGE_WELCOME # Trang chào mừng của trình cài đặt.
# !insertmacro MUI_PAGE_LICENSE "resources\eula.txt" # Thêm trang EULA vào trình cài đặt.
!insertmacro MUI_PAGE_DIRECTORY # Trang chọn thư mục cài đặt.
!insertmacro MUI_PAGE_INSTFILES # Trang đang cài đặt.
!insertmacro MUI_PAGE_FINISH # Trang hoàn tất cài đặt.

!insertmacro MUI_UNPAGE_INSTFILES # Trang đang gỡ cài đặt.

!insertmacro MUI_LANGUAGE "English" # Đặt ngôn ngữ của trình cài đặt.

## Có thể dùng hai lệnh sau để ký trình cài đặt và trình gỡ cài đặt. Đường dẫn tới binary được truyền trong %1.
#!uninstfinalize 'signtool --file "%1"'
#!finalize 'signtool --file "%1"'

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe" # Tên file trình cài đặt.
!ifdef WAILS_INSTALL_SCOPE
  !if "${WAILS_INSTALL_SCOPE}" == "user"
    InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
  !else
    InstallDir "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
  !endif
!else
  InstallDir "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
!endif # Thư mục cài đặt mặc định ($PROGRAMFILES là thư mục Program Files).
ShowInstDetails show # Luôn hiển thị chi tiết cài đặt.

Function .onInit
   !insertmacro wails.checkArchitecture

   StrCpy $Relaunch 0
   ClearErrors
   ${GetOptions} $CMDLINE "/relaunch" $0
   IfErrors +2
   StrCpy $Relaunch 1
FunctionEnd

Section
    !insertmacro wails.setShellContext

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR

    # Ứng dụng thoát ngay sau khi khởi chạy trình cài đặt này; chờ tối đa 15 giây để có thể ghi đè exe cũ.
    StrCmp $Relaunch 1 0 skipWait
    IfFileExists "$INSTDIR\${PRODUCT_EXECUTABLE}" 0 skipWait
    StrCpy $0 0
    waitExe:
        ClearErrors
        FileOpen $1 "$INSTDIR\${PRODUCT_EXECUTABLE}" a
        IfErrors 0 exeFree
        IntOp $0 $0 + 1
        IntCmp $0 30 skipWait 0 skipWait
        Sleep 500
        Goto waitExe
    exeFree:
        FileClose $1
    skipWait:

    !insertmacro wails.files
    File "${ARG_DB_DLL}"

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols

    !insertmacro wails.writeUninstaller

    # Khởi chạy ứng dụng qua explorer.exe để ứng dụng chạy với quyền của người dùng thông thường, không dùng quyền quản trị của trình cài đặt.
    StrCmp $Relaunch 1 0 +2
    Exec '"$WINDIR\explorer.exe" "$INSTDIR\${PRODUCT_EXECUTABLE}"'
SectionEnd

Section "uninstall"
    !insertmacro wails.setShellContext

RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # Xóa thư mục dữ liệu WebView2.

    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller
SectionEnd
