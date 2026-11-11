//
//  WebViewState.swift
//  FollowNative
//
//  Created by Innei on 2025/1/31.
//

import Combine
import UIKit

struct ImagePreviewEvent {
  let imageUrls: [String]
  let index: Int
}

struct AudioSeekEvent {
  let time: Double
}

struct OpenLinkEvent {
  let url: String
}

struct BridgeReadyEvent {
  /// The bridge protocol version of the page; nil from a page older than the handshake
  let version: Int?
}

final class WebViewState: ObservableObject {
  @Published public var contentHeight: CGFloat
  @Published public var imagePreviewEvent: ImagePreviewEvent?
  @Published public var audioSeekEvent: AudioSeekEvent?
  @Published public var openLinkEvent: OpenLinkEvent?
  @Published public var bridgeReadyEvent: BridgeReadyEvent?

  public init() {
    self.contentHeight = 0
  }

  public func setInitialContentHeightIfNeeded() {
    guard Thread.isMainThread, contentHeight == 0 else { return }
    contentHeight = UIScreen.main.bounds.height
  }

  public func previewImages(urls: [String], index: Int) {
    imagePreviewEvent = ImagePreviewEvent(imageUrls: urls, index: index)
  }

  public func seekAudio(time: Double) {
    audioSeekEvent = AudioSeekEvent(time: time)
  }

  /// The app decides how a link of the page opens, as its setting says
  public func openLink(url: URL) {
    openLinkEvent = OpenLinkEvent(url: url.absoluteString)
  }

  public func bridgeReady(version: Int?) {
    bridgeReadyEvent = BridgeReadyEvent(version: version)
  }
}
