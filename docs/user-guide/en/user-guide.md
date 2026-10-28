# S3 Browser User Guide

Version 0.0.1-beta.1

## 1. Introduction

S3 Browser is a desktop application for browsing and managing buckets and objects on **AWS S3** and on S3-compatible servers such as **MinIO**. With it you can:

- save connection profiles and connect to several accounts at the same time (one tab per connection);
- browse buckets, folders and objects, and search them;
- see the details of an object;
- upload files and folders (drag and drop or a dialog), with a live progress window;
- download objects and review the download history;
- delete objects and whole folders.

The interface is available in English, Vietnamese and Japanese.

![Main window](images/01-main-window.png)

The window has three areas: the **profile list** on the left, the **tabs** on the right (each tab shows the buckets and objects of one connection) and the **header** at the top with the **Settings** button and the download history button.

> This is a beta version (0.0.1-beta.1). Please keep a copy of important data before deleting objects: a deletion cannot be undone.

## 2. Installation

There are two ways to get the application on Windows.

- **Installer**: run the installer and follow the steps. The application is then available from the Start menu. Profiles and the download history are stored in your user profile.
- **Portable**: copy the portable folder anywhere (for example a USB drive) and run `S3Browser.exe`. It uses the WebView2 runtime shipped in the `webview2` folder and keeps its data in the `data` folder next to the program, so nothing is written elsewhere. Do not move the `webview2` and `data` folders away from the program.

## 3. Connect to AWS S3 or MinIO

Click the **Create connection profile** button (the second button above the profile list). The **Connection Profile** window opens.

![Connection profile form](images/03-connect-modal.png)

| Field | Description |
| --- | --- |
| AWS / MinIO | Choose the type of server. MinIO switches **Path style** on automatically. |
| Profile name | The name shown in the profile list and in the tab. |
| Profile color | The color of the profile in the list. |
| Endpoint | The address of the server, for example `https://s3.amazonaws.com` or `http://localhost:9000`. Required. |
| Region | The region of your account, for example `North Virginia [us-east-1]`. Required. |
| Access key | The access key of your account. Required. |
| Secret key | The secret key of your account. Click the eye icon to show it. |
| Path style | Addresses buckets as `endpoint/bucket` instead of `bucket.endpoint`. Needed by MinIO and most self-hosted servers. |
| Save secret key | Stores the secret key (encrypted) in the profile. Without it you must type the secret key every time you connect. |
| Auto connect | Connects the profile when the application starts. Available only when **Save secret key** is ticked. |

Two buttons are available at the bottom:

- **Test connection** checks the values without saving anything. A green message tells you the test succeeded; a red message explains the problem (see [Troubleshooting](#9-troubleshooting)).
- **Create profile** saves the profile (when you open the window from an existing profile, the button reads **Update profile**).

> Never share a screenshot that shows your secret key. The key fields in this guide contain placeholder values only.

## 4. Manage profiles

After you create a profile, it appears in the profile list.

![Profile created](images/04-profile-created.png)

Right-click a profile to open its menu.

![Profile menu](images/05-profile-menu.png)

- **Connect**: opens the connection. A connected profile shows a green icon.
- **Disconnect**: closes the connection. Disconnect first before you edit or delete a profile.
- **Edit**: changes the profile (the window title is again **Connection Profile**, and the button is **Update profile**). You are asked to confirm the update.
- **Delete**: removes the profile after you confirm.

![Delete a profile](images/18-profile-delete-confirm.png)

A profile that still has an upload or a download running cannot be deleted. Wait for the transfers to finish or cancel them first.

The first button above the list (**Connect**) opens the same window with a **Connect** button, to connect once without saving a profile, and the **Refresh connection profile list** button reloads the list.

## 5. Browse buckets and objects

Each tab works with one profile. To use a profile in a tab, choose it in the drop-down at the top left of the tab, then click the **Connect** button next to it (if the profile is not connected yet). Use the **+** button (**Add tab**) to open another tab, for example for a second account.

The list of buckets is shown:

![Bucket list](images/06-bucket-list.png)

Click a bucket to see its objects. Folders are shown first; click a folder to open it. The path above the list (for example `demo-photos / travel / 2026`) is clickable, and the arrow button goes back one level (to the parent folder, or to the bucket list from the top of a bucket).

![Objects of a bucket](images/08-object-list.png)

![Inside a folder](images/09-object-folder.png)

Large buckets are loaded page by page; more objects are loaded automatically as you scroll down. Use the **Refresh** button (**Refresh object list** or **Refresh bucket list**) to reload the current view.

## 6. Search

Type in the search box above the list and press Enter (or click the magnifier).

- In the bucket list you search by **name**.
- Inside a bucket you search by **key** (the name of the objects and folders in the current folder that contain the text; the search is not case-sensitive and does not go into sub-folders).

![Search buckets](images/07-bucket-search.png)

![Search objects](images/12-object-search.png)

When the result list ends with **Search more**, click it to continue searching. The **x** in the search box clears the search.

## 7. Object details

Click a file to open the **Object details** panel on the right. It shows the name, key, size, last modified date, ETag, content type, storage class and the metadata of the object. The copy buttons next to the key and the ETag copy the value to the clipboard. If the details cannot be loaded, click **Retry**. Close the panel with the **Close** button.

![Object details](images/10-object-detail.png)

## 8. Transfer and delete objects

### 8.1 Upload

There are two ways to upload to the folder (or bucket) you are looking at.

**Drag and drop.** Drag files and folders from your file manager onto the object list. Dropping a folder uploads all the files inside it, keeping the folder structure. Dragging cannot be shown in a screenshot.

**Upload dialog.** Click the **Upload files** button (the arrow pointing up above the list). The **Upload files** window opens and shows the target (**Upload to: ...**).

![Upload dialog](images/13-upload-modal.png)

- Click **Select files** and choose files in the dialog of your system, or drag files and folders into the window.
- The list shows every file with its size. Untick a file to leave it out, click the trash icon to remove it from the list, or use **Remove selected**.
- When you opened the dialog from the bucket list, choose the target bucket first.
- Click **Upload** to start.

![Files ready to upload](images/14-upload-modal-files.png)

The following limits apply, to keep a transfer manageable:

| Limit | Value |
| --- | --- |
| Files from one folder per upload | 50 |
| Large files (over 10 GiB) from one folder | 4 |
| Files per upload | 1000 |
| Uploads at the same time | 1 (wait until the running upload finishes) |

When a dropped folder is over a limit, the window **Choose files to upload** lets you tick the files to upload; folders within the limits are uploaded in full. Items that cannot be uploaded (unreadable files, symbolic links) are skipped, and you are told how many.

The **Uploading** window appears at the bottom right with the progress of each file (the percentage ring, **Uploaded** and **Remaining**). Click **Cancel** on a file, or **Cancel all** at the top, to stop. The window can be closed and reopened from its button.

![Upload progress](images/15-upload-progress.png)

When the upload is done, click **Refresh** to see the new objects.

![The new object in the list](images/16-object-uploaded.png)

### 8.2 Download

- For one object, open the **More actions** menu (three dots) at the end of its row and choose **Download**. A dialog asks where to save the file.
- For several objects, tick them (up to 5), then click **Download selected** in the toolbar. A dialog asks for the destination folder.

Folders cannot be downloaded; they are left out of the selection.

The **Downloading** window shows the progress of each file (**Downloaded** and **Remaining**) and has **Cancel** and **Cancel all** buttons. The image below shows the window.

![Download progress](images/19-download-progress.png)

Click the clock button at the top right to open the **Download history**: every download with its size, time, status and destination path.

### 8.3 Select several objects

Tick the check boxes at the start of the rows. The toolbar then shows **Clear selected**, **Download selected** and **Delete selected**. You can select at most 5 objects at a time for download or delete.

![Selected objects](images/11-object-selection.png)

### 8.4 Delete

Open the **More actions** menu of the object and choose **Delete**, or select objects and click **Delete selected**. A confirmation window shows what will be deleted; click **OK** to confirm.

![Delete confirmation](images/17-delete-confirm.png)

Deleting a **folder** removes the folder **and everything inside it**. The confirmation says so, and the action cannot be undone. If some objects cannot be deleted, the message tells you how many failed and how many were deleted.

## 9. Settings (theme, font, language)

Click the **Settings** button (gear icon) at the top right, left of the download history button.

- **Theme**: Light, Dark or Follow system.
- **Font**: Nunito, System UI, Segoe UI, Arial, Monospace or JetBrains Mono.
- **Language**: English, Tiếng Việt or 日本語. The whole interface changes, including messages.
- **Launch on Windows startup**: start S3Browser when you sign in to Windows. Only shown in the installed Windows version (not the portable one).

Every change is previewed immediately. Then choose:

- **Save**: keep the settings, also after restarting the app.
- **Apply**: keep the settings until you close the app; the dialog stays open. Launch on Windows startup is not changed by Apply.
- **Cancel** or **X**: undo the changes made since the last Apply or Save.
- **Reset to default**: put the form back to the defaults (Light, Nunito, English, off). Click **Save** to keep them.

Settings are loaded when the app starts, before the window content appears.

## 10. Troubleshooting

Messages appear at the top of the window. These are the ones you may meet most often.

| Message | Cause and what to do |
| --- | --- |
| Access key or secret key is not valid for this endpoint. | The keys are wrong or belong to another server. Check them in the profile and use **Test connection**. |
| Timed out reaching the endpoint, check the address and whether the server is running. | The endpoint is wrong, the server is stopped, a firewall or the network blocks it. Check the address (with `http://` or `https://`) and the port. |
| The endpoint rejected. / Error while connect to S3 bucket. | The server answered but refused the connection. Check the endpoint, the region and **Path style** (needed for MinIO). |
| Profile: {name} is not connected. | The connection was closed. Connect the profile again. |
| Get list bucket error / Get list object error | The account may not be allowed to list buckets or the bucket, or the connection was lost. Check the permissions of the keys and reconnect. |
| Access bucket is limited. | Your account cannot list all buckets. Ask for the missing permission, or open a bucket you are allowed to use. |
| Another upload is running, please wait until it finishes. | Only one upload runs at a time. Wait for it, or cancel it from the **Uploading** window. |
| Folder ... has more than 50 files to upload. / Upload at most 1000 files at a time. | See the limits in section 8.1. Split the upload or choose fewer files. |
| Profile [{name}] has uploads or downloads in progress, cannot delete. | Wait for the transfers to finish or cancel them, then delete the profile. |
| Please disconnect before action! | Disconnect the profile (right-click, **Disconnect**) before editing or deleting it. |
| Maximum item selected is 5! | Select at most 5 objects for download or delete. |
| Destination ... not exists. | The folder chosen for a download is not available. Choose another location. |

If a message is not listed here, it contains the name of the operation and the reason reported by the server. The reason (for example `AccessDenied` or `NoSuchBucket`) is the message of S3 itself and tells you what to fix on the server side.

The screenshots of the two connection errors below were taken with **Test connection**.

![Invalid credentials](images/21-error-invalid-credentials.png)

![Unreachable endpoint](images/22-error-endpoint.png)
