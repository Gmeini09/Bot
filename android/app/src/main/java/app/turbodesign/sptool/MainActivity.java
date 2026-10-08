package app.turbodesign.sptool;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * SP Tool for Android: a full-screen WebView with the SP Tool web app.
 * - Only the web app's own host is shown inside the app; every other link (Discord sign-in, Discord, help pages)
 *   opens in the phone's browser. Sign-in therefore happens on discord.com in the real browser – the app never
 *   sees a password; it only receives its session from the licence server, exactly like the PC version.
 * - File picking (sounds, soundpack ZIPs, .rpf) uses the system file picker.
 * - Finished soundpacks are written to Downloads/SP Tool via window.SPToolAndroid (blob downloads do not work in a WebView).
 */
public class MainActivity extends Activity {
    static final String APP_URL = BuildConfig.APP_URL;
    private static final int PICK_FILES = 41;

    private WebView web;
    private ValueCallback<Uri[]> pendingPick;
    private final Map<String, Save> saves = new HashMap<>();

    private static final class Save { Uri uri; OutputStream out; String name; }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#0D0F14"));
        w.setNavigationBarColor(Color.parseColor("#0D0F14"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#08090C"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setUserAgentString(s.getUserAgentString() + " SPToolAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "SPToolAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (isAppUrl(u)) return false;
                openOutside(u);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // window.open (Discord sign-in): open the URL in the phone's browser instead of a second WebView.
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView probe = new WebView(MainActivity.this);
                probe.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                        openOutside(req.getUrl());
                        v.destroy();
                        return true;
                    }
                });
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(probe);
                resultMsg.sendToTarget();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingPick != null) pendingPick.onReceiveValue(null);
                pendingPick = callback;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*"); // .rpf has no MIME type – the app checks the files itself
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(Intent.createChooser(i, "Dateien wählen"), PICK_FILES);
                } catch (ActivityNotFoundException e) {
                    pendingPick = null;
                    return false;
                }
                return true;
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl(APP_URL);
    }

    private static boolean isAppUrl(Uri u) {
        Uri app = Uri.parse(APP_URL);
        return "https".equals(u.getScheme()) && app.getHost() != null && app.getHost().equalsIgnoreCase(u.getHost());
    }

    private void openOutside(Uri u) {
        String scheme = u.getScheme();
        if (scheme == null || !(scheme.equals("https") || scheme.equals("http") || scheme.equals("mailto"))) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Kein Browser gefunden.", Toast.LENGTH_LONG).show();
        }
    }

    private void showOffline() {
        String html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<body style='margin:0;min-height:100vh;display:grid;place-items:center;background:#08090C;color:#F5F7FA;font:16px system-ui'>"
            + "<div style='text-align:center;padding:24px'><h2>Keine Verbindung</h2>"
            + "<p style='color:#9098A7'>SP Tool braucht beim Start Internet. Prüf deine Verbindung.</p>"
            + "<a href='" + APP_URL + "' style='display:inline-block;margin-top:12px;padding:12px 20px;border-radius:10px;background:#3B82F6;color:#fff;text-decoration:none'>Erneut versuchen</a></div></body>";
        web.loadDataWithBaseURL(APP_URL, html, "text/html", "utf-8", APP_URL);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_FILES || pendingPick == null) { super.onActivityResult(requestCode, resultCode, data); return; }
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int k = 0; k < n; k++) result[k] = data.getClipData().getItemAt(k).getUri();
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        pendingPick.onReceiveValue(result);
        pendingPick = null;
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        for (Save sv : saves.values()) abortSave(sv);
        saves.clear();
        web.destroy();
        super.onDestroy();
    }

    private void abortSave(Save sv) {
        try { if (sv.out != null) sv.out.close(); } catch (Exception ignored) { }
        try { getContentResolver().delete(sv.uri, null, null); } catch (Exception ignored) { }
    }

    private static String safeName(String n) {
        String s = n == null ? "" : n.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]+", " ").trim();
        if (s.isEmpty()) s = "SP Tool Datei";
        return s.length() > 100 ? s.substring(0, 100) : s;
    }

    /** window.SPToolAndroid – saves files in Downloads/SP Tool (MediaStore, no storage permission needed). */
    private final class Bridge {
        @JavascriptInterface
        public String begin(String name) {
            synchronized (saves) {
                Save sv = new Save();
                sv.name = safeName(name);
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, sv.name);
                v.put(MediaStore.Downloads.MIME_TYPE, sv.name.toLowerCase().endsWith(".zip") ? "application/zip" : "application/octet-stream");
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/SP Tool");
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                ContentResolver cr = getContentResolver();
                try {
                    sv.uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (sv.uri == null) return "";
                    sv.out = cr.openOutputStream(sv.uri);
                } catch (Exception e) {
                    return "";
                }
                String id = UUID.randomUUID().toString();
                saves.put(id, sv);
                return id;
            }
        }

        @JavascriptInterface
        public boolean append(String id, String b64) {
            Save sv;
            synchronized (saves) { sv = saves.get(id); }
            if (sv == null || sv.out == null) return false;
            try {
                sv.out.write(Base64.decode(b64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String finish(String id) {
            Save sv;
            synchronized (saves) { sv = saves.remove(id); }
            if (sv == null) return "";
            try {
                sv.out.close();
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(sv.uri, v, null, null);
            } catch (Exception e) {
                abortSave(sv);
                return "";
            }
            final String shown = "Downloads/SP Tool/" + sv.name;
            runOnUiThread(() -> Toast.makeText(MainActivity.this, "Gespeichert: " + shown, Toast.LENGTH_LONG).show());
            return shown;
        }

        @JavascriptInterface
        public void abort(String id) {
            Save sv;
            synchronized (saves) { sv = saves.remove(id); }
            if (sv != null) abortSave(sv);
        }
    }
}
