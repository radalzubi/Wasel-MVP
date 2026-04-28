import { useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import PhoneFrame from './PhoneFrame'
import HomeScreen     from './screens/HomeScreen'
import BookScreen     from './screens/BookScreen'
import MatchingScreen from './screens/MatchingScreen'
import TripScreen     from './screens/TripScreen'
import RatingScreen   from './screens/RatingScreen'

type ScreenId = 'home' | 'book' | 'matching' | 'trip' | 'rating'
const ORDER: ScreenId[] = ['home', 'book', 'matching', 'trip', 'rating']

const variants = {
  enter: (d: number) => ({ x: d > 0 ? '100%' : '-100%', opacity: 0   }),
  center:              ({ x: 0,    opacity: 1   }),
  exit:  (d: number) => ({ x: d < 0 ? '100%' : '-100%', opacity: 0   }),
}

const transition = { type: 'tween' as const, duration: 0.28, ease: [0.4, 0, 0.2, 1] }

export default function AppPreview() {
  const [screen, setScreen]    = useState<ScreenId>('home')
  const [direction, setDir]    = useState(1)

  const go = useCallback((to: ScreenId) => {
    setDir(ORDER.indexOf(to) > ORDER.indexOf(screen) ? 1 : -1)
    setScreen(to)
  }, [screen])

  const next = useCallback(() => {
    const idx = ORDER.indexOf(screen)
    if (idx < ORDER.length - 1) go(ORDER[idx + 1])
  }, [screen, go])

  const back = useCallback(() => {
    const idx = ORDER.indexOf(screen)
    if (idx > 0) go(ORDER[idx - 1])
  }, [screen, go])

  return (
    <PhoneFrame>
      <AnimatePresence custom={direction} mode="wait" initial={false}>
        <motion.div
          key={screen}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={transition}
          className="absolute inset-0 overflow-hidden"
        >
          {screen === 'home'     && <HomeScreen     onNext={next} />}
          {screen === 'book'     && <BookScreen     onNext={next} onBack={back} />}
          {screen === 'matching' && <MatchingScreen onNext={next} onBack={back} />}
          {screen === 'trip'     && <TripScreen     onNext={next} />}
          {screen === 'rating'   && <RatingScreen   onBack={() => go('home')} />}
        </motion.div>
      </AnimatePresence>
    </PhoneFrame>
  )
}
