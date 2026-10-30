const { withMainActivity } = require("expo/config-plugins");

// FULL_USER respects rotation lock. Measure the display, not the possibly letterboxed window; folds don't recreate the activity.

const ORIENTATION_METHODS = `
  // Applied in onCreate and re-applied on fold/unfold; added by
  // withAndroidTabletOrientation.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applyTabletOrientation()
  }

  private fun applyTabletOrientation() {
    requestedOrientation = if (displaySmallestWidthDp() >= 600) {
      ActivityInfo.SCREEN_ORIENTATION_FULL_USER
    } else {
      ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }
  }

  // configuration.densityDpi is what WindowMetrics.getDensity() reports; letterboxing leaves it unscaled.
  private fun displaySmallestWidthDp(): Int {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = windowManager.maximumWindowMetrics.bounds
      return minOf(bounds.width(), bounds.height()) * DisplayMetrics.DENSITY_DEFAULT / resources.configuration.densityDpi
    }
    val metrics = DisplayMetrics()
    @Suppress("DEPRECATION")
    windowManager.defaultDisplay.getRealMetrics(metrics)
    return minOf(metrics.widthPixels, metrics.heightPixels) * DisplayMetrics.DENSITY_DEFAULT / metrics.densityDpi
  }
`;

const ORIENTATION_ON_CREATE_CALL = `
    applyTabletOrientation()`;

function insertAfter(contents, anchor, insertion, description) {
  const index = contents.indexOf(anchor);
  if (index === -1) {
    throw new Error(
      `withAndroidTabletOrientation: could not find ${description} in MainActivity — the Expo template changed; update the plugin anchors.`,
    );
  }
  const end = index + anchor.length;
  return contents.slice(0, end) + insertion + contents.slice(end);
}

module.exports = function withAndroidTabletOrientation(config) {
  return withMainActivity(config, (nextConfig) => {
    let contents = nextConfig.modResults.contents;
    if (nextConfig.modResults.language !== "kt") {
      throw new Error("withAndroidTabletOrientation: MainActivity must be Kotlin.");
    }
    if (contents.includes("SCREEN_ORIENTATION_FULL_USER")) {
      return nextConfig;
    }

    contents = insertAfter(
      contents,
      "import android.os.Bundle",
      "\nimport android.content.pm.ActivityInfo\nimport android.content.res.Configuration\nimport android.util.DisplayMetrics",
      "the android.os.Bundle import",
    );
    contents = insertAfter(
      contents,
      "class MainActivity : ReactActivity() {",
      ORIENTATION_METHODS,
      "the MainActivity class declaration",
    );
    contents = insertAfter(
      contents,
      "super.onCreate(null)",
      ORIENTATION_ON_CREATE_CALL,
      "the super.onCreate call",
    );

    nextConfig.modResults.contents = contents;
    return nextConfig;
  });
};
