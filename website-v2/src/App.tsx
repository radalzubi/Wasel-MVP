import Navbar from './components/layout/Navbar'
import Footer from './components/layout/Footer'
import Hero from './components/sections/Hero'
import PreviewSection from './components/sections/PreviewSection'
import FeatureDrivers from './components/sections/FeatureDrivers'
import FeatureDispatch from './components/sections/FeatureDispatch'
import FeatureRiders from './components/sections/FeatureRiders'
import HowItWorks from './components/sections/HowItWorks'
import Trust from './components/sections/Trust'
import FinalCTA from './components/sections/FinalCTA'

export default function App() {
  return (
    <div className="bg-w-bg min-h-screen overflow-x-hidden">
      <Navbar />
      <main>
        <Hero />
        <PreviewSection />
        <FeatureDrivers />
        <FeatureDispatch />
        <FeatureRiders />
        <HowItWorks />
        <Trust />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  )
}
