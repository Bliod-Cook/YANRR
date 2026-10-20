const FIREBASE_CONFIG_DEFAULT = JSON.stringify({
  apiKey: "AIzaSyBpGB2C2Vz-9ktivqVkW7uTtVopNh3ELvo",
  authDomain: "diygod-folo.firebaseapp.com",
  projectId: "diygod-folo",
  storageBucket: "diygod-folo.firebasestorage.app",
  messagingSenderId: "992336953943",
  appId: "1:992336953943:web:998aae576c8bc77dc11912",
  measurementId: "G-HS4SF4GHWG",
})

export const DEFAULT_VALUES = {
  PROD: {
    API_URL: "http://localhost:3000/api",
    OTA_URL: "https://ota.folo.is",
    WEB_URL: "http://localhost:3000",
    INBOXES_EMAIL: "@follow.re",
    FIREBASE_CONFIG: FIREBASE_CONFIG_DEFAULT,
  },
  DEV: {
    API_URL: "https://api.dev.folo.is",
    OTA_URL: "https://ota.folo.is",
    WEB_URL: "https://dev.folo.is",
    INBOXES_EMAIL: "__dev@follow.re",
  },
  STAGING: {
    API_URL: "https://api.folo.is",
    OTA_URL: "https://ota.folo.is",
    WEB_URL: "https://staging.follow.is",
    INBOXES_EMAIL: "@follow.re",
  },
  LOCAL: {
    API_URL: "http://localhost:3000/api",
    OTA_URL: "http://localhost:8787",
    WEB_URL: "http://localhost:3000",
    INBOXES_EMAIL: "@follow.re",
  },
}
