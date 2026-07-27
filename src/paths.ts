const home = process.env.HOME ?? "."

export const configurationDirectory =
  process.env.TERMHOG_CONFIG_DIR ??
  `${process.env.XDG_CONFIG_HOME ?? `${home}/.config`}/termhog`

export const configurationFile = `${configurationDirectory}/config.json`

export const cacheDirectory =
  process.env.TERMHOG_CACHE_DIR ??
  `${process.env.XDG_CACHE_HOME ?? `${home}/.cache`}/termhog`

export const cacheFile = `${cacheDirectory}/stats.json`
export const textSnapshotFile = `${cacheDirectory}/snapshot.txt`
export const ansiSnapshotFile = `${cacheDirectory}/snapshot.ansi`
export const refreshLockFile = `${cacheDirectory}/refresh.lock`
