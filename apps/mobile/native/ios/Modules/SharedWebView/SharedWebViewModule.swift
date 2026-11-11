//
//  SharedWebViewModule.swift
//
//  Created by Innei on 2025/1/29.
//

import Combine
import ExpoModulesCore
import WebKit

let onContentHeightChanged = "onContentHeightChanged"
let onImagePreview = "onImagePreview"
let onSeekAudio = "onSeekAudio"
let onOpenLink = "onOpenLink"
let onBridgeReady = "onBridgeReady"

// Functions run on the JavaScript thread and hand everything to the main thread, which
// `WebViewManager` is bound to
public class SharedWebViewModule: Module {
  private var cancellables = Set<AnyCancellable>()

  public func definition() -> ModuleDefinition {
    Name("FOSharedWebView")

    Function("load") { (urlString: String) in
      DispatchQueue.main.async {
        WebViewManager.load(urlString)
      }
    }

    // Centralized dispatch to JS layer (native -> JS)
    Function("dispatch") { (type: String, payload: String?) in
      let payloadExpr: String
      if let payload = payload {
        // payload is JSON string; pass via JSON.parse to avoid double-escaping
        payloadExpr = "JSON.parse(\(self.jsonString(payload)))"
      } else {
        payloadExpr = "null"
      }
      let js =
        "(function(){ if (window.__FO_BRIDGE__ && typeof window.__FO_BRIDGE__.dispatch === 'function') { window.__FO_BRIDGE__.dispatch(\(self.jsonString(type)), \(payloadExpr)); } })()"
      DispatchQueue.main.async {
        WebViewManager.recordJSON(key: type, payload: payload)
        WebViewManager.evaluateJavaScript(js)
      }
    }

    View(WebViewView.self) {
      Events("onContentHeightChange")
      Events("onSeekAudio")

      Prop("url") { (_: UIView, urlString: String) in
        WebViewManager.load(urlString)
      }
    }

    Events(onContentHeightChanged)
    Events(onImagePreview)
    Events(onSeekAudio)
    Events(onOpenLink)
    Events(onBridgeReady)

    OnCreate {
      DispatchQueue.main.async {
        WebViewManager.initializeLifecycleObservers()
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        WebViewManager.cleanupLifecycleObservers()
      }
    }

    OnStartObserving {
      DispatchQueue.main.async { [weak self] in
        self?.observe(WebViewManager.state)
      }
    }

    OnStopObserving {
      DispatchQueue.main.async { [weak self] in
        self?.cancellables.forEach { $0.cancel() }
        self?.cancellables.removeAll()
      }
    }

    // Debug helpers
    AsyncFunction("getDebugState") { (promise: Promise) in
      DispatchQueue.main.async {
        promise.resolve(WebViewManager.debugState())
      }
    }
    Function("destroyForDebug") {
      DispatchQueue.main.async {
        WebViewManager.destroyForDebug()
      }
    }
    Function("reloadLastURL") {
      DispatchQueue.main.async {
        WebViewManager.reloadLastURL()
      }
    }
    Function("flushQueue") {
      DispatchQueue.main.async {
        WebViewManager.flushForDebug()
      }
    }
  }

  private func observe(_ state: WebViewState) {
    state.$contentHeight
      .receive(on: DispatchQueue.main)
      .sink { [weak self] height in
        self?.sendEvent(onContentHeightChanged, ["height": height])
      }
      .store(in: &cancellables)

    state.$imagePreviewEvent
      .receive(on: DispatchQueue.main)
      .compactMap { $0 }
      .sink { [weak self] event in
        self?.sendEvent(onImagePreview, ["imageUrls": event.imageUrls, "index": event.index])
      }
      .store(in: &cancellables)

    state.$audioSeekEvent
      .receive(on: DispatchQueue.main)
      .compactMap { $0 }
      .sink { [weak self] event in
        self?.sendEvent(onSeekAudio, ["time": event.time])
      }
      .store(in: &cancellables)

    state.$openLinkEvent
      .receive(on: DispatchQueue.main)
      .compactMap { $0 }
      .sink { [weak self] event in
        self?.sendEvent(onOpenLink, ["url": event.url])
      }
      .store(in: &cancellables)

    state.$bridgeReadyEvent
      .receive(on: DispatchQueue.main)
      .compactMap { $0 }
      .sink { [weak self] event in
        self?.sendEvent(onBridgeReady, ["version": event.version])
      }
      .store(in: &cancellables)
  }

  fileprivate func jsonString(_ value: String) -> String {
    // Encode as JSON string literal
    let data = try? JSONSerialization.data(withJSONObject: ["v": value], options: [])
    if let data = data, let s = String(data: data, encoding: .utf8) {
      if let range = s.range(of: ":") {
        return String(s[range.upperBound..<s.index(before: s.endIndex)])
      }

      let escaped = value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(
        of: "\"", with: "\\\"")
      return "\"\(escaped)\""
    }
    return ""
  }
}
