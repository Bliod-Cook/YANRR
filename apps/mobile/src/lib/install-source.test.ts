import { describe, expect, it, vi } from "vitest"

vi.mock("react-native-device-info", () => ({
  default: { getInstallerPackageNameSync: vi.fn() },
}))

vi.mock("./platform", () => ({ isAndroid: true }))

const { getAndroidInstallSource } = await import("./install-source")

describe("Android install source", () => {
  it("tells Google Play installs from other installers", () => {
    expect(getAndroidInstallSource("com.android.vending")).toBe("google-play")
    expect(getAndroidInstallSource("com.google.android.packageinstaller")).toBe("other")
    expect(getAndroidInstallSource("org.fdroid.fdroid")).toBe("other")
    expect(getAndroidInstallSource("unknown")).toBe("unknown")
    expect(getAndroidInstallSource(null)).toBe("unknown")
  })
})
