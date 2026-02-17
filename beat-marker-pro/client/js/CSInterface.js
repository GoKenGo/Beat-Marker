/**
 * Minimal CSInterface for Adobe CEP Extensions
 * Wraps the __adobe_cep__ object injected by the CEP runtime
 */

function CSInterface() {
  this.hostEnvironment = JSON.parse(window.__adobe_cep__.getHostEnvironment());
}

CSInterface.prototype.getHostEnvironment = function () {
  return this.hostEnvironment;
};

CSInterface.prototype.evalScript = function (script, callback) {
  if (callback === null || callback === undefined) {
    callback = function () {};
  }
  window.__adobe_cep__.evalScript(script, callback);
};

CSInterface.prototype.getSystemPath = function (pathType) {
  var path = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
  var OSVersion = this.getOSInformation();
  if (OSVersion.indexOf("Windows") >= 0) {
    path = path.replace("file:///", "");
  } else if (OSVersion.indexOf("Mac") >= 0) {
    path = path.replace("file://", "");
  }
  return path;
};

CSInterface.prototype.getOSInformation = function () {
  var userAgent = navigator.userAgent;
  if (userAgent.indexOf("Windows") >= 0) return "Windows";
  if (userAgent.indexOf("Mac OS") >= 0) return "Mac OS";
  return "Unknown";
};

CSInterface.prototype.openURLInDefaultBrowser = function (url) {
  window.__adobe_cep__.invokeAsync("vulcan.SuiteMessage.cycleKey", url, function () {});
  if (navigator.userAgent.indexOf("Mac OS") >= 0) {
    this.evalScript('app.openURL("' + url + '")');
  }
};

CSInterface.prototype.addEventListener = function (type, listener, obj) {
  window.__adobe_cep__.addEventListener(type, listener, obj);
};

CSInterface.prototype.removeEventListener = function (type, listener, obj) {
  window.__adobe_cep__.removeEventListener(type, listener, obj);
};

CSInterface.prototype.requestOpenExtension = function (extensionId, startupParams) {
  window.__adobe_cep__.requestOpenExtension(extensionId, startupParams || "");
};

CSInterface.prototype.closeExtension = function () {
  window.__adobe_cep__.closeExtension();
};

// System path constants
CSInterface.prototype.EXTENSION_ID = "com.beatmarkerpro.panel.main";
var SystemPath = {
  USER_DATA: "userData",
  COMMON_FILES: "commonFiles",
  MY_DOCUMENTS: "myDocuments",
  APPLICATION: "application",
  EXTENSION: "extension",
  HOST_APPLICATION: "hostApplication",
};
