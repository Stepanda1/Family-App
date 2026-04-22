const { createRunOncePlugin, withProjectBuildGradle } = require("@expo/config-plugins");

const REACT_NATIVE_NODE_MODULES_DIR_LINE =
  'rootProject.ext.REACT_NATIVE_NODE_MODULES_DIR = new File(rootProject.projectDir, "../../../node_modules/react-native")';

function withReactNativeMonorepoFix(config) {
  return withProjectBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      return gradleConfig;
    }

    if (gradleConfig.modResults.contents.includes("REACT_NATIVE_NODE_MODULES_DIR")) {
      return gradleConfig;
    }

    gradleConfig.modResults.contents = `${gradleConfig.modResults.contents.trimEnd()}\n\n${REACT_NATIVE_NODE_MODULES_DIR_LINE}\n`;
    return gradleConfig;
  });
}

module.exports = createRunOncePlugin(
  withReactNativeMonorepoFix,
  "with-react-native-monorepo-fix",
  "1.0.0"
);
