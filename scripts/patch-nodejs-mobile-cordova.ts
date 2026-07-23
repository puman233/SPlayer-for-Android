import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFile), "..");

const pluginLinkPath = path.join(rootDir, "node_modules", "nodejs-mobile-cordova");

let pluginRoot: string;
try {
  pluginRoot = await realpath(pluginLinkPath);
} catch {
  console.log("nodejs-mobile-cordova is not installed. Skipping patch.");
  process.exit(0);
}
const gradleFile = path.join(pluginRoot, "src", "android", "build.gradle");
const nodeJsFile = path.join(
  pluginRoot,
  "src",
  "android",
  "java",
  "com",
  "janeasystems",
  "cdvnodejsmobile",
  "NodeJS.java",
);
const original = await readFile(gradleFile, "utf8");

const projectBlock =
  "String projectWWW; // www assets folder from the Application project.\n" +
  '    if ( file("${project.projectDir}/src/main/assets/www/").exists() ) {\n' +
  "        // www folder for cordova-android >= 7\n" +
  '        projectWWW = "${project.projectDir}/src/main/assets/www";\n' +
  '    } else if (file("${project.projectDir}/assets/www/").exists()) {\n' +
  "        // www folder for cordova-android < 7\n" +
  '        projectWWW = "${project.projectDir}/assets/www";\n' +
  "    } else {\n" +
  "        throw new GradleException('nodejs-mobile-cordova couldn\\'t find the www folder in the Android project.');\n" +
  "    }";

const replacementBlock =
  "String projectWWW; // www assets folder from the Application project.\n" +
  '    if ( file("${rootProject.projectDir}/app/src/main/assets/public/").exists() ) {\n' +
  "        // public folder for Capacitor Android\n" +
  '        projectWWW = "${rootProject.projectDir}/app/src/main/assets/public";\n' +
  '    } else if ( file("${rootProject.projectDir}/app/src/main/assets/www/").exists() ) {\n' +
  "        // www folder for cordova-android >= 7\n" +
  '        projectWWW = "${rootProject.projectDir}/app/src/main/assets/www";\n' +
  '    } else if ( file("${rootProject.projectDir}/app/assets/www/").exists() ) {\n' +
  "        // www folder for cordova-android < 7\n" +
  '        projectWWW = "${rootProject.projectDir}/app/assets/www";\n' +
  '    } else if ( file("${project.projectDir}/src/main/assets/public/").exists() ) {\n' +
  "        // public folder for Capacitor Android when the plugin is evaluated in the app module\n" +
  '        projectWWW = "${project.projectDir}/src/main/assets/public";\n' +
  '    } else if ( file("${project.projectDir}/src/main/assets/www/").exists() ) {\n' +
  "        // www folder for cordova-android >= 7\n" +
  '        projectWWW = "${project.projectDir}/src/main/assets/www";\n' +
  '    } else if (file("${project.projectDir}/assets/www/").exists()) {\n' +
  "        // www folder for cordova-android < 7\n" +
  '        projectWWW = "${project.projectDir}/assets/www";\n' +
  "    } else {\n" +
  "        throw new GradleException('nodejs-mobile-cordova couldn\\'t find the www folder in the Android project.');\n" +
  "    }";

let patchedGradle = original;

if (
  !original.includes("${rootProject.projectDir}/app/src/main/assets/public/") &&
  original.includes("String projectWWW;")
) {
  patchedGradle = patchedGradle.replace(projectBlock, replacementBlock);
}

// Capacitor 会在 app 和 Cordova 聚合模块各应用一次脚本，原生库只需由 app 构建
if (!patchedGradle.includes('if (project.name == "app") {\nandroid {')) {
  patchedGradle = patchedGradle.replace(
    "android {\n    defaultConfig {",
    'if (project.name == "app") {\nandroid {\n    defaultConfig {',
  );
  patchedGradle = patchedGradle.replace(
    "\n}\n\nimport org.gradle.internal.os.OperatingSystem;",
    "\n}\n}\n\nimport org.gradle.internal.os.OperatingSystem;",
  );
}

if (patchedGradle !== original) {
  await writeFile(gradleFile, patchedGradle, "utf8");
}

const originalNodeJs = await readFile(nodeJsFile, "utf8");
const patchedNodeJs = originalNodeJs.replace(
  "if (BuildConfig.DEBUG) {",
  "if (Log.isLoggable(LOGTAG, Log.DEBUG)) {",
);
if (patchedNodeJs !== originalNodeJs) {
  await writeFile(nodeJsFile, patchedNodeJs, "utf8");
}

console.log(`Patched nodejs-mobile-cordova for Capacitor compatibility: ${pluginRoot}`);
