//
//  HelperModule.swift
//  Pods
//
//  Created by Innei on 2025/2/7.
//
import ExpoModulesCore
import UIKit

let onWindowControlsInsetsChange = "onWindowControlsInsetsChange"

public class HelperModule: Module {
  public func definition() -> ExpoModulesCore.ModuleDefinition {
    Name("Helper")

    Events(onWindowControlsInsetsChange)

    // Room the iPadOS window controls take past the safe area, see WindowControlsInsetsObserver
    AsyncFunction("getWindowControlsInsets") { () -> [String: Double] in
      WindowControlsInsetsObserver.shared.currentInsets().dictionary
    }.runOnQueue(.main)

    OnStartObserving(onWindowControlsInsetsChange) {
      DispatchQueue.main.async { [weak self] in
        let observer = WindowControlsInsetsObserver.shared
        observer.onChange = { insets in
          self?.sendEvent(onWindowControlsInsetsChange, insets.dictionary)
        }
        observer.installProbeIfNeeded()
      }
    }

    OnStopObserving(onWindowControlsInsetsChange) {
      DispatchQueue.main.async {
        WindowControlsInsetsObserver.shared.onChange = nil
      }
    }

    // Settles once the browser closes, or right away when nothing opens, as a closed browser would
    AsyncFunction("openLink") { (urlString: String, promise: Promise) in
      guard let url = URL(string: urlString) else {
        promise.resolve(["type": "dismiss"])
        return
      }
      DispatchQueue.main.async {
        WebViewManager.presentModalWebView(url: url) {
          promise.resolve(["type": "dismiss"])
        }
      }
    }

    AsyncFunction("dismissPresentedBrowser") { (promise: Promise) in
      DispatchQueue.main.async {
        WebViewManager.dismissPresentedBrowser { dismissed in
          promise.resolve(dismissed)
        }
      }
    }

    Function("scrollToTop") { (reactTag: Int) in
      DispatchQueue.main.async { [weak self] in
        guard let scrollView = self?.findUIView(withTag: reactTag) as UIScrollView? else { return }
        scrollView.setContentOffset(
          CGPoint(x: scrollView.contentOffset.x, y: -scrollView.adjustedContentInset.top),
          animated: true
        )
      }
    }
  }

  /// The first view of type `T` in the view of `reactTag`, itself included
  private func findUIView<T: UIView>(withTag reactTag: Int) -> T? {
    findUIViewOfType(view: appContext?.findView(withTag: reactTag, ofType: UIView.self))
  }

  private func findUIViewOfType<T: UIView>(view: UIView?) -> T? {
    guard let view = view else {
      return nil
    }
    if let view = view as? T {
      return view
    }

    let subviews = view.subviews
    for subview in subviews {
      if let targetView = findUIViewOfType(view: subview) as T? {
        return targetView
      }
    }
    return nil
  }
}
