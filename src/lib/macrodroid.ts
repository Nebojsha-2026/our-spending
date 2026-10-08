// A ready-to-import MacroDroid macro for Android capture, so nobody has to
// build it by hand: Notification Received (Google Wallet and the big four
// banks' apps) → HTTP POST of the notification to /api/ingest with this
// phone's token. The shape follows MacroDroid's own export format
// (macroExportVersion 1); the server does all the parsing (src/lib/notifications.ts).

/** Apps whose notifications are forwarded: label → Android package. */
export const CAPTURE_APPS: [string, string][] = [
  ["Google Wallet", "com.google.android.apps.walletnfcrel"],
  ["ANZ", "com.anz.android.gomoney"],
  ["NAB", "au.com.nab.mobile"],
  ["CommBank", "com.commbank.netbank"],
  ["Westpac", "org.westpac.bank"],
];

/** MacroDroid's magic text for the notification title, text and app name. */
export const MACRODROID_BODY = '{"raw": "{not_title} | {notification}", "app": "{not_app_name}", "source": "android"}';

// MacroDroid ids are 64-bit; any distinct number works, so stay JS-safe.
const id = () => -Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

export function buildMacro(opts: { url: string; token: string; name?: string; now?: number }) {
  const name = opts.name ?? "Our spending: log card payments";
  const common = { disableLogging: false, m_constraintList: [], m_isDisabled: false, m_isOrCondition: false };

  const trigger = {
    enableRegex: false,
    ignoreCase: true,
    m_applicationNameList: CAPTURE_APPS.map(([label]) => label),
    m_exactMatch: false,
    m_excludeApps: false,
    m_excludes: false,
    m_ignoreOngoing: true,
    m_option: 0,
    m_packageNameList: CAPTURE_APPS.map(([, pkg]) => pkg),
    m_soundOption: 0,
    m_supressMultiples: false,
    m_textContent: "",
    matchOptionMessage: 0,
    matchOptionTitle: 0,
    separateTitleAndMessage: false,
    ...common,
    m_SIGUID: id(),
    m_classType: "NotificationTrigger",
    m_comment: "Payment notifications from Google Wallet and bank apps",
  };

  const request = {
    requestConfig: {
      allowAnyCertificate: false,
      basicAuthEnabled: false,
      basicAuthPassword: "",
      basicAuthUsername: "",
      blockNextAction: false,
      clientCertEnabled: false,
      clientCertKeyStoreDisplayName: "",
      clientCertKeyStoreUri: "",
      clientCertPassword: "",
      contentBodyDynamicFileName: "",
      contentBodyFileDisplayName: "",
      contentBodyFileUri: "",
      contentBodyFolderDisplayName: "",
      contentBodyFolderUri: "",
      contentBodySource: 0,
      contentBodyText: MACRODROID_BODY,
      contentType: "application/json",
      followRedirects: true,
      headerParams: [
        { paramName: "Content-Type", paramValue: "application/json" },
        { paramName: "Authorization", paramValue: `Bearer ${opts.token}` },
      ],
      localFileUri: "",
      prettifyJson: false,
      queryParams: [],
      requestTimeOutSeconds: 30,
      requestType: 1, // POST
      responseVariableName: "response",
      saveResponseFileName: "",
      saveResponseFolderPathDisplayName: "",
      saveResponseFolderPathUri: "",
      saveResponseType: 1,
      saveReturnCodeToVariable: false,
      saveReturnHeadersToVariable: false,
      urlToOpen: opts.url,
      useLocalFileUri: false,
      useStaticContentBodyFile: true,
    },
    ...common,
    m_SIGUID: id(),
    m_classType: "HttpRequestAction",
    m_comment: "Send the notification to Our spending",
  };

  return {
    globalVariables: [],
    macro: {
      breakpoints: [],
      disabledTimestamp: 0,
      exportedActionBlocks: [],
      exportedSharedScenes: [],
      forceEvenIfNotEnabledTimestamp: 0,
      isActionBlock: false,
      isExtra: false,
      isFavourite: false,
      lastEditedTimestamp: opts.now ?? Date.now(),
      localVariables: [
        {
          description: "The app's reply (not used)",
          dictionary: { entries: [], isArray: false, variableType: 4, type: "Dictionary" },
          isActionBlockWorkingVar: false,
          isLocalVar: true,
          isSecure: false,
          m_booleanValue: false,
          m_decimalValue: 0.0,
          m_intValue: 0,
          m_name: "response",
          m_stringValue: "",
          m_type: 2, // string
          supportsInput: true,
          supportsOutput: true,
        },
      ],
      localVarsAlphabetical: false,
      loggingLevel: 0,
      m_GUID: id(),
      m_actionList: [request],
      m_category: "Finance",
      m_completed: true,
      m_constraintList: [],
      m_description:
        "Logs card payments in Our spending: when Google Wallet or your bank's app shows a payment notification, " +
        "its text is sent to your app, which works out the amount and shop. Keep MacroDroid's notification access on " +
        "and its battery use Unrestricted.",
      m_descriptionOpen: false,
      m_enabled: true,
      m_excludeLog: false,
      m_headingColor: 0,
      m_isOrCondition: false,
      m_name: name,
      m_triggerList: [trigger],
    },
    macroExportVersion: 1,
  };
}

/** The macro as a file the phone can save and open in MacroDroid. */
export function macroFile(opts: { url: string; token: string }) {
  return new Blob([JSON.stringify(buildMacro(opts), null, 1)], { type: "application/octet-stream" });
}
