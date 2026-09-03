function versionParts(value) {
  return `${value || ''}`.split(/[.-]/).slice(0, 3).map(part => Number.parseInt(part, 10) || 0)
}

function isNewerVersion(candidate, current) {
  const next = versionParts(candidate)
  const installed = versionParts(current)
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index]
  }
  return false
}

module.exports = { isNewerVersion }
