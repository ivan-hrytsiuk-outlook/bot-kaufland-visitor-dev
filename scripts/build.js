import fs from "fs"
import path from "path"
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const packageDir = path.join(__dirname, '../')
const content = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json')).toString());

content.type = "module"
fs.writeFileSync(path.join(packageDir, '/dist/esm/package.json'), JSON.stringify(content, null, 4))

content.type = "commonjs"
fs.writeFileSync(path.join(packageDir, '/dist/cjs/package.json'), JSON.stringify(content, null, 4))