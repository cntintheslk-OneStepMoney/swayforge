'use strict';

// electron-builder normalises portions of this configuration in place, so this
// adapter must remain mutable. Repository policy tests enforce the values below.
module.exports = {
  appId: 'app.swayforge.desktop',
  productName: 'SwayForge',
  asar: true,
  compression: 'normal',
  directories: {
    output: 'dist',
    buildResources: 'build'
  },
  files: [
    'package.json',
    'src/**/*'
  ],
  artifactName: '${productName}-${version}-win-${arch}.${ext}',
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ],
    executableName: 'SwayForge',
    icon: 'build/icon.svg',
    forceCodeSigning: false
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'SwayForge',
    uninstallDisplayName: 'SwayForge',
    deleteAppDataOnUninstall: false,
    artifactName: '${productName}-${version}-win-${arch}-setup.${ext}'
  }
};
