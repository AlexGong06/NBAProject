export async function wait(timeMs: number): Promise<void> {
    await new Promise((res) => {
        setTimeout(() => {
          res('')
        }, timeMs)
      })
}