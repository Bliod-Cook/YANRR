import { createRequire } from "node:module"

import { describe, expect, it } from "vitest"

const { addRNFBPodfileSettings } = createRequire(import.meta.url)(
  "./with-rnfb-build-properties.js",
) as { addRNFBPodfileSettings: (contents: string) => string }

// The parts of Expo's Podfile template the plugin anchors to
const PODFILE = `require 'json'
podfile_properties = JSON.parse(File.read(File.join(__dir__, 'Podfile.properties.json'))) rescue {}

prepare_react_native_project!

target 'Yanrr' do
  use_expo_modules!

  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
    )
  end
end
`

describe("addRNFBPodfileSettings", () => {
  it("links React Native Firebase statically without Swift Package Manager, with or without Firebase config", () => {
    const contents = addRNFBPodfileSettings(PODFILE)
    const target = contents.indexOf("target 'Yanrr'")

    // RNFB reads both flags while the pods are declared, so they come before the target
    expect(contents.indexOf("$RNFirebaseAsStaticFramework = true")).toBeLessThan(target)
    expect(contents.indexOf("$RNFirebaseDisableSPM = true")).toBeGreaterThan(-1)
    expect(contents.indexOf("$RNFirebaseDisableSPM = true")).toBeLessThan(target)
  })

  it("adds the settings once however often prebuild runs", () => {
    const once = addRNFBPodfileSettings(PODFILE)

    expect(addRNFBPodfileSettings(once)).toBe(once)
  })
})
