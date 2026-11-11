const mousePosition = { x: 0, y: 0 }

export const setMousePosition = (x: number, y: number) => {
  mousePosition.x = x
  mousePosition.y = y
}

/** The last known pointer position, for imperative reads only; it is not reactive. */
export const getMousePosition = (): Readonly<typeof mousePosition> => mousePosition
