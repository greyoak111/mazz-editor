import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('Blender 5.2.0 Mazz W94D Fixture\n');
  process.exit(0);
}

const sceneIndex = args.indexOf('--background');
const separator = args.lastIndexOf('--');
const scenePath = sceneIndex >= 0 ? args[sceneIndex + 1] : '';
const tail = separator >= 0 ? args.slice(separator + 1) : [];
const mode = tail.length === 1 ? 'render' : tail[0];
const outputPath = tail.length === 1 ? tail[0] : tail[1];
if (!scenePath || !outputPath || !['render', 'inspect', 'export-obj'].includes(mode)) {
  process.stderr.write('W94D_ARGUMENT_CONTRACT_INVALID\n');
  process.exit(2);
}

const behavior = fs.readFileSync(scenePath, 'utf8');
if (behavior.includes('SLEEP')) {
  process.stdout.write('W94D_FIXTURE_SLEEPING\n');
  setInterval(() => {}, 1000);
} else if (behavior.includes('CRASH')) {
  process.stderr.write('W94D_FIXTURE_CRASH\n');
  process.exit(17);
} else if (behavior.includes('FAIL')) {
  if (behavior.includes('PARTIAL')) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from('partial-output'));
  }
  process.stderr.write('W94D_FIXTURE_RENDER_FAILED\n');
  process.exit(9);
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (mode === 'render') {
    fs.writeFileSync(outputPath, Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('MAZZ_W94D_FIXTURE_PNG'),
    ]));
  } else if (mode === 'inspect') {
    fs.writeFileSync(outputPath, `${JSON.stringify({ schema: 'mazz.blender-inspection/v1', scene: path.basename(scenePath), frame: 1, objects: [] })}\n`);
  } else {
    fs.writeFileSync(outputPath, '# Mazz W94D fixture OBJ\nv 0 0 0\no Fixture\n');
  }
  process.stdout.write(`W94D_OUTPUT=${outputPath}\n`);
}
