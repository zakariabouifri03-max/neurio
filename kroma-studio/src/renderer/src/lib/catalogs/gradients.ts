import type { FillSpec } from '../../../../shared/types/document'
import { gradient } from '../../../../shared/utils/document'

export interface GradientPreset {
  id: string
  label: string
  fill: FillSpec
}

const G = (id: string, label: string, colors: [string, string], angle = 90): GradientPreset => ({
  id,
  label,
  fill: gradient(
    [
      { color: colors[0], offset: 0 },
      { color: colors[1], offset: 1 }
    ],
    angle
  )
})

export const GRADIENT_PRESETS: GradientPreset[] = [
  G('violet', 'Violet Dusk', ['#7C5CFF', '#2B2D63']),
  G('peach', 'Peach Fizz', ['#FF9F45', '#F2545B']),
  G('mint', 'Mint Fresh', ['#38D39F', '#0077B6']),
  G('sunset', 'Sunset', ['#FF7B00', '#7A1E5C']),
  G('ocean', 'Deep Ocean', ['#00B4D8', '#03045E']),
  G('grape', 'Grape', ['#FF2EC4', '#4B2FD6']),
  G('sand', 'Desert Sand', ['#E8C39E', '#7C4A2D']),
  G('steel', 'Steel', ['#D6D6DA', '#3A3A3D']),
  G('forest', 'Pine', ['#95D5B2', '#1B4332']),
  G('candy', 'Candy', ['#FF4FA3', '#FFB347'], 45),
  G('neon', 'Neon', ['#00F0FF', '#FF2EC4'], 135),
  G('gold', 'Gold', ['#FFD166', '#8B5A2B'], 60)
]

export const SOLID_SWATCHES = [
  '#FFFFFF', '#F5F3FF', '#C9B8FF', '#7C5CFF', '#4B2FD6', '#2B2D63', '#0F1024', '#000000',
  '#FF5F7A', '#FF2EC4', '#FF7B00', '#FFD166', '#FFB347', '#E8C39E', '#C87941', '#7C4A2D',
  '#38D39F', '#40916C', '#1B4332', '#95D5B2', '#00B4D8', '#0077B6', '#03045E', '#57B8FF',
  '#3A3A3D', '#8A8A8F', '#D6D6DA', '#EFD3D7', '#FEEAFA', '#8B88A0'
]
