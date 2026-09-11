# README

## About

This is the official Wails React-TS template.

You can configure the project by editing `wails.json`. More information about the project settings can be found
here: https://wails.io/docs/reference/project-config

## Live Development

Run `go tool wails3 generate bindings -ts` to update IPC function before start app.
Run `sqlc generate` to generate queries template.

To run in live development mode, run `go tool wails3 task dev` in the project directory. This will run a Vite development
server that will provide very fast hot reload of your frontend changes. If you want to develop in a browser
and have access to your Go methods, there is also a dev server that runs on http://localhost:34115. Connect
to this in your browser, and you can call your Go code from devtools.

## Building

Build application `go tool wails3 task build`
Build production `go tool wails3 task package`
Build production without admin scope `go tool wails3 task package INSTALL_SCOPE=user`