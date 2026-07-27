const runs = 25
const warmups = 5
const samples: Array<number> = []

for (let index = 0; index < runs; index++) {
  const start = performance.now()
  const result = Bun.spawnSync(["./dist/termhog-prompt"], {
    stdout: "ignore",
    stderr: "ignore",
  })
  const duration = performance.now() - start

  if (result.exitCode !== 0) {
    throw new Error(`termhog-prompt exited with ${result.exitCode}`)
  }
  if (index >= warmups) samples.push(duration)
}

const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
const result = {
  samples: samples.length,
  minMs: Number(Math.min(...samples).toFixed(2)),
  meanMs: Number(mean.toFixed(2)),
  maxMs: Number(Math.max(...samples).toFixed(2)),
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
