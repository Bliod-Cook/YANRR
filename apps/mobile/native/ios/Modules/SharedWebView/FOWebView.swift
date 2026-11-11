//
//  FOWebView.swift
//  FollowNative
//
//  Created by Innei on 2025/2/7.
//

@preconcurrency import WebKit

class FOWebView: WKWebView {
  private func setupView() {
    scrollView.isScrollEnabled = false
    scrollView.bounces = false
    scrollView.contentInsetAdjustmentBehavior = .never

    isOpaque = false
    backgroundColor = UIColor.clear
    scrollView.backgroundColor = UIColor.clear
    tintColor = Utils.accentColor

    #if DEBUG
      if #available(iOS 16.4, *) {
        isInspectable = true
      }
    #endif
  }

  private var state: WebViewState!

  init(frame: CGRect, state: WebViewState) {
    let configuration = FOWKWebViewConfiguration()

    super.init(frame: frame, configuration: configuration)
    configuration.userContentController.add(self, name: "message")
    self.state = state

    setupView()
    navigationDelegate = self
    uiDelegate = self
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}

private class FOWKWebViewConfiguration: WKWebViewConfiguration {
  private static let sharedProcessPool = WKProcessPool()
  override init() {
    super.init()
    let configuration = self

    // Share process pool and default data store across instances for faster warm-up
    configuration.processPool = FOWKWebViewConfiguration.sharedProcessPool
    configuration.websiteDataStore = .default()

    let atStartScripts = WKWebView.loadInjectedJs(forResource: "at_start")

    if let jsString = atStartScripts {
      let script = WKUserScript(
        source: jsString,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
      )
      configuration.userContentController.addUserScript(script)
    }

    configuration.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

    let atEndScripts = WKWebView.loadInjectedJs(forResource: "at_end")
    guard let jsString = atEndScripts else {
      print("Failed to load injected js")
      return
    }
    let script2 = WKUserScript(
      source: jsString,
      injectionTime: .atDocumentEnd,
      forMainFrameOnly: true
    )

    configuration.userContentController.addUserScript(script2)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}

private extension WKWebView {
  static func loadInjectedJs(forResource: String) -> String? {
    if let bundleURL = Bundle(for: WebViewView.self).url(
      forResource: "js", withExtension: "bundle"
    ),
      let resourceBundle = Bundle(url: bundleURL)
    {
      if let jsPath = resourceBundle.path(forResource: forResource, ofType: "js") {
        do {
          let initJsContent = try String(contentsOfFile: jsPath, encoding: .utf8)

          return initJsContent
        } catch {
          print("Error reading JS file:", error)
        }
      }
    }
    return nil
  }
}

extension FOWebView: WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    // The handler is open to every frame, and an article's iframes are not the app's
    guard message.frameInfo.isMainFrame, message.name == "message",
      let jsonString = message.body as? String, let decode = jsonString.data(using: .utf8),
      let data = try? JSONDecoder().decode(BridgeDataBasePayload.self, from: decode)
    else { return }

    switch data.type {
    case "ready":
      // Notify manager that the bridge is ready and flush queued scripts
      DispatchQueue.main.async {
        WebViewManager.markReadyAndFlush()
      }
    case "bridgeReady":
      guard let data = try? JSONDecoder().decode(BridgeReadyPayload.self, from: decode) else {
        return
      }
      state.bridgeReady(version: data.payload?.version)
    case "setContentHeight":
      let data = try? JSONDecoder().decode(
        SetContentHeightPayload.self, from: decode
      )
      guard let data = data else { return }

      DispatchQueue.main.async {
        self.state.contentHeight = data.payload
      }

    case "measure":
      measureWebView(self)

    case "previewImage":
      let data = try? JSONDecoder().decode(
        PreviewImagePayload.self, from: decode
      )

      guard let data = data else { return }
      DispatchQueue.main.async {
        let urls = data.payload.imageUrls
        let index = data.payload.index ?? 0
        if !urls.isEmpty {
          self.state.previewImages(urls: urls, index: index)
        }
      }
    case "audio:seekTo":
      let data = try? JSONDecoder().decode(
        AudioSeekPayload.self, from: decode
      )
      guard let data = data else { return }
      DispatchQueue.main.async {
        self.state.seekAudio(time: data.payload.time)
      }

    default:
      break
    }
  }

  private func measureWebView(_ webView: WKWebView) {
    let jsCode = "document.querySelector('#root').scrollHeight"
    webView.evaluateJavaScript(jsCode) { height, _ in
      if let height = height as? CGFloat, height > 0 {
        DispatchQueue.main.async {
          self.state.contentHeight = height
          debugPrint("measure", height)
        }
      }
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    measureWebView(webView)

    Timer.scheduledTimer(withTimeInterval: 1, repeats: false) { [weak self] _ in
      self?.measureWebView(webView)
    }
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    // Attempt a graceful recovery via the manager
    DispatchQueue.main.async {
      WebViewManager.handleProcessTerminated()
    }
  }

  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url {
      state.openLink(url: url)
    }
    return nil
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.cancel)
      return
    }
    // A link that opens a new window, as the links of articles do
    if navigationAction.targetFrame == nil {
      state.openLink(url: url)
      decisionHandler(.cancel)
      return
    }
    // The shared web view stays on the renderer, which an iframe must not navigate away
    if navigationAction.targetFrame?.isMainFrame == true, !WebViewManager.isRendererPage(url) {
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }
}
