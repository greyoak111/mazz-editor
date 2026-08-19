import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('Blender 4.3.0 Mazz W79 Fixture\n');
  process.exit(0);
}

const sceneIndex = args.indexOf('--background');
const separator = args.lastIndexOf('--');
const scenePath = sceneIndex >= 0 ? args[sceneIndex + 1] : '';
const outputPath = separator >= 0 ? args[separator + 1] : '';
if (!scenePath || !outputPath) {
  process.stderr.write('FIXTURE_ARGUMENTS_INVALID\n');
  process.exit(2);
}

const behavior = fs.readFileSync(scenePath, 'utf8');
if (behavior.includes('SLEEP')) {
  process.stdout.write('FIXTURE_SLEEPING\n');
  setInterval(() => {}, 1000);
} else if (behavior.includes('FAIL')) {
  if (behavior.includes('PARTIAL')) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from('partial-output'));
  }
  process.stderr.write('FIXTURE_RENDER_FAILED\n');
  process.exit(9);
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('MAZZ_W79_FIXTURE_PNG'),
  ]);
  fs.writeFileSync(outputPath, png);
  process.stdout.write(`MAZZ_BLENDER_OUTPUT=${outputPath}\n`);
}
