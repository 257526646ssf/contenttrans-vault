const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vault", {
  authStatus: () => ipcRenderer.invoke("auth-status"),
  unlock: (code) => ipcRenderer.invoke("unlock", code),
  lock: () => ipcRenderer.invoke("lock"),
  getMessages: (query) => ipcRenderer.invoke("get-messages", query),
  sendMessage: (text) => ipcRenderer.invoke("send-message", text),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  listFiles: (query) => ipcRenderer.invoke("list-files", query),
  uploadFiles: () => ipcRenderer.invoke("upload-files"),
  uploadFilePathsForTest: (filePaths) => ipcRenderer.invoke("upload-file-paths-for-test", filePaths),
  downloadFile: (file) => ipcRenderer.invoke("download-file", file),
  downloadFileToPathForTest: (file, targetPath) => ipcRenderer.invoke("download-file-to-path-for-test", file, targetPath),
  setDeviceName: (deviceName) => ipcRenderer.invoke("set-device-name", deviceName),
  toggleAlwaysOnTop: () => ipcRenderer.invoke("toggle-always-on-top"),
  openWeb: () => ipcRenderer.invoke("open-web"),
  onUploadProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("upload-progress", listener);
    return () => ipcRenderer.removeListener("upload-progress", listener);
  },
});
