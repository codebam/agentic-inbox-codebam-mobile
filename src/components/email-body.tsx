/**
 * Native email body renderer: a JavaScript-disabled WebView showing the
 * CSP-locked document from buildEmailDocument. Links open externally; the
 * view itself can never navigate anywhere.
 */

import { Linking, StyleSheet } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";

export function EmailBody({ html, background }: { html: string; background: string }) {
  return (
    <WebView
      originWhitelist={["about:blank"]}
      source={{ html }}
      style={[styles.webview, { backgroundColor: background }]}
      containerStyle={{ backgroundColor: background }}
      javaScriptEnabled={false}
      domStorageEnabled={false}
      setSupportMultipleWindows={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      onShouldStartLoadWithRequest={(request: WebViewNavigation) => {
        const { url } = request;
        if (url === "about:blank" || url.startsWith("about:")) return true;
        if (/^https?:\/\//i.test(url)) void Linking.openURL(url);
        return false;
      }}
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
  },
});
