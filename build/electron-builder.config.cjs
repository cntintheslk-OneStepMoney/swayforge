'use strict';

module.exports = Object.freeze({
  appId: 'app.swayforge.desktop',
  productName: 'SwayForge',
  asar: true,
  compression: 'normal',
  directories: Object.freeze({
    output: 'dist',
    buildResources: 'build'
  }),
  files: Object.freeze([
    'package.json',
    'src/**/*'
  ]),
  artifactName: '${productName}-${version}-win-${arch}.${ext}',
  win: Object.freeze({
    target: Object.freeze([
      Object.freeze({
        target: 'nsis',
        arch: Object.freeze(['x64'])
      })
    ]),
    executableName: 'SwayForge',
    icon: 'build/icon.svg',
    forceCodeSigning: false
  }),
  nsis: Object.freeze({
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'SwayForge',
    uninstallDisplayName: 'SwayForge',
    deleteAppDataOnUninstall: false,
    artifactName: '${productName}-${version}-win-${arch}-setup.${ext}'
  })
});
