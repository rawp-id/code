package app.kode.editor;

import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the web UI start the Kode server inside Termux and then connect to it
 * over `ws://127.0.0.1:3177/ws`.
 *
 * Termux must be installed and configured with `allow-external-apps=true`
 * (see ~/.termux/termux.properties).
 */
@CapacitorPlugin(name = "KodeServer")
public class ServerPlugin extends Plugin {

    private static final String TERMUX_PACKAGE = "com.termux";
    private static final String TERMUX_RUN_COMMAND = "com.termux.RUN_COMMAND";
    private static final String TERMUX_HOME = "/data/data/com.termux/files/home";
    private static final String TERMUX_BASH = "/data/data/com.termux/files/usr/bin/bash";

    @PluginMethod
    public void isTermuxInstalled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("installed", isPackageInstalled(TERMUX_PACKAGE));
        call.resolve(result);
    }

    @PluginMethod
    public void startInTermux(PluginCall call) {
        String command = call.getString("command", "./start.sh");
        String workdir = call.getString("workdir", "~/kode-server");
        if (!isPackageInstalled(TERMUX_PACKAGE)) {
            call.reject("Termux is not installed");
            return;
        }
        try {
            Intent intent = new Intent();
            intent.setComponent(
                new ComponentName(TERMUX_PACKAGE, "com.termux.app.RunCommandService")
            );
            intent.setAction(TERMUX_RUN_COMMAND);
            intent.putExtra("com.termux.RUN_COMMAND_PATH", TERMUX_BASH);
            intent.putExtra(
                "com.termux.RUN_COMMAND_ARGUMENTS",
                new String[] { "-lc", "cd '" + workdir + "' && " + command }
            );
            intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", TERMUX_HOME);
            intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            intent.putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0");
            intent.putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", "Kode Server");
            getContext().startService(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Failed to start Termux command: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void openTermux(PluginCall call) {
        Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(TERMUX_PACKAGE);
        if (intent == null) {
            call.reject("Termux is not installed");
            return;
        }
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Failed to open Termux: " + error.getMessage(), error);
        }
    }

    private boolean isPackageInstalled(String packageName) {
        try {
            getContext().getPackageManager().getPackageInfo(packageName, 0);
            return true;
        } catch (PackageManager.NameNotFoundException notFound) {
            return false;
        }
    }
}
