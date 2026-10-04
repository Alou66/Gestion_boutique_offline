const fs = require('fs')
const path = require('path')

const from = path.join('electron', 'database', 'migrations')
const to = path.join('dist-electron', 'database', 'migrations')

fs.mkdirSync(path.dirname(to), { recursive: true })
fs.cpSync(from, to, { recursive: true })
console.log('Migrations copied to dist-electron/database/migrations')
