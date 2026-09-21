# Installer publishing

Do not commit Electron installer binaries directly to Git history. They are large generated artifacts and can exceed GitHub's normal per-file Git limit.

`.github/workflows/windows-installer.yml` builds the NSIS installer on a Windows runner after every push to `main`, uploads it as an Actions artifact, and publishes/replaces it on the matching versioned GitHub Release.
