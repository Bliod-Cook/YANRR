//
//  Utils.swift
//  FollowNative
//
//  Created by Innei on 2025/2/7.
//

import Foundation
import UIKit

enum Utils {
  static let accentColor = UIColor(cgColor: .init(red: 255 / 255, green: 92 / 255, blue: 0, alpha: 1))

  /// The controller to present from: UIKit presents nothing over one that presents already
  static func topViewController() -> UIViewController? {
    guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
      var top = scene.windows.first?.rootViewController
    else {
      return nil
    }
    while let presented = top.presentedViewController {
      top = presented
    }
    return top
  }
}
