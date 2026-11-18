// Words that are rare in everyday English but need no learning: numbers, plain forms of common words,
// compounds that say what they mean, international science words. Chosen by hand from the answer choices
// of the question bank. A list, not a rule: a rule on word parts would also take "hardship" and "overlook".
// Names, foreign words of a passage and broken forms are here too: they are no vocabulary to learn.
const PLAIN = `
  sixth tenth twelve fifty eleventh twelfth thirteen thirteenth fourteen fourteenth fifteen fifteenth sixteen sixteenth seventeen
  seventeenth eighteen eighteenth nineteen nineteenth twentieth thirtieth fortieth fiftieth sixtieth
  seventieth eightieth ninetieth hundredth thousandth

  broader coldest cooler earliest farther heavier hotter narrower safer shorter shortest smallest softer
  taller thicker warmer warmest weaker wider

  additionally afterward amazingly chemically culturally differently emotionally genetically gently
  geographically historically locally negatively pleasantly poorly sadly softly unexpectedly unfairly visually

  disagree disagreement dislike harmful harmless inaccurate incomplete incorrect inexpensive invisible
  unclear unexpected unfair unharmed uninteresting unrelated untrue misunderstand misunderstood

  animator composer creator economist experimenter explorer historian listener musician organizer
  physicist researcher sailor seller thinker viewer

  artwork audiocassette cliffside countryside farmworker flycatcher gift-giver hardworking homeland
  hunter-gatherers iceberg jellyfish mapmaker newsboy playlist printmaking pushpin sandpainting seafloor
  shortcut smartphone songbird sunlight timeline underwater workshop

  alpha analyse analyze animation artistic asteroid astronomer astronomy atmospheric atom bacteria beta
  calcium canoe chrysanthemum dinosaur dioxide electron fictional geological governmental helium hydrogen
  lithium magnet magnetic marathon meteor methane microplastic microscopic mineral molecular molecule
  monoxide mythology nitrogen oxygen photograph planetary poem poetic realistic robot sculpture sodium
  summarize technological titanium zinc

  ant bean bee bicycle bubble bumblebee coin colorful communicate creature dive duck duckling educate
  enjoyment essay feather fence frog goat imagination insect invent invention lonely measurement mixture
  mosquito mosquitoes northeastern organize pig pleasant pond popularity pork puzzle rocky rubber
  salty saltiness shark shiny shout snake treasure tuna tunnel weakness whale worm

  aristotle plato thailand utah hanoi cherokee navajo guinea cupid nigeria seneca lulu
  meng mengsedih serga ikaah bree choy parachinensi explicacione mimesi mimos poema robota mtorolite fregata thale
  bufo jorō sōsaku hanga ukiyo styrene ethylene butylene raffinose bufadienolide jasmonic
`;

// International words a Russian speaker reads at sight, with the meaning the Russian word has
// (automation — автоматизация, algorithm — алгоритм): rare in English text, so the frequency list
// called them hard, and the student marked them «знаю» one by one (2026-11-18). Chosen by hand from
// the question bank's words. False friends stay cards: accurate is not «аккуратный», sympathy not
// «симпатия», fabric not «фабрика»; so do words with a second sense Russian lacks (observe a rule,
// qualify a claim, a vocal critic) and words the student has forgotten before.
export const INTERNATIONAL = new Set(`
  abstract absurd academia accelerator accessory accumulate accumulation acoustic activate activation actively
  activism activist adapt adaptation aerospace aesthetic aesthetically algorithm alphabet alternatively
  altruistically ambition ambitious amphibian anaerobic analogous analytical analyzer anatomical antagonist
  antenna antennae anthropologist anthropology apparatus appetite arch archaeological archaeologist architect
  archive artifact assimilate astronaut astronomical astrophysic atomic authentic authentically authoritarian
  authorship automate automation automobile automotive autonomy bacterial barrier billiard binary biochemical
  biochemist biologist biomass biome blouse boutique boxer bronze bureaucratic cacao calculate calculation canal
  canonical capitalism capitalistic carbide carbonate cassette catalog catastrophic categorization categorizing
  cellulose centralized ceramic characteristic characterization characterize chemist chimpanzee chloroform
  chronicle chronological circulation civilization clan classically classify clichéd cluster cognition
  cognitively collaborate collaborative collaborator collapse collectively collector colonial colonialism colony
  combine commentary commentator commercially communicative companion compensate compile composite compositional
  compress compromise concentrate conceptual conceptually construct consult consultant container contextual
  contextualize continent continental conversion convert cooperative coordinate coral corona corpora corpus
  correlate correlation corrupt corset cosmic cosmochemist cosmogenic costume crater creatively crises critic
  criticize critique crystalline cultivate cultivation curate cyanobacterium decentralized decorate deficiency
  deform deformation demographic demonstrate desegregation destabilizing destructive detect detection diameter
  dictate dietary diffraction dipeptide diplomacy dipole disco discourse distant distantly distribute divergence
  diversification diversify doctrine dominant dominate donation donor dopamine dramatizing duplication dynamism
  ecological ecologically ecologist ecosystem ecotype effectiveness electoral electorally electromagnetic
  electronically elegant emoji empirical empirically encoded endoskeleton energetic enthusiasm enthusiast
  entropy enzyme epoch equator erode erosion ethical ethnobiologist eukaryote eukaryotic evolutionary evolve
  exoplanet exoskeleton expansionist export exterior extract extraction extrapolated extrapolating fantastical
  fermentation fermented figuratively financially fluctuations fluorescence fragment fragmentation fundamentally
  galactic gaseous gelatinous generalization generate genome genre geochemical geographer geographic geologist
  geology geometric geometry geophysicist gesture gigantic gigantism globally glucose gram gravitational
  hegemonic heroic heroine herpetologist hexagonal hierarchical hierarchy histamine hobby hominid hominin
  horizontal humor hyacinth hybrid hypotheses hypothesis hypothesize hypothesized hypothetical icon iconic
  idealism ideological illuminate illusion illustrate illustration imitation immigrant immigrated imperial
  impulse inaugural indication indicator industrialization inform informal infrastructural ingredient inhibitor
  initiate innovative innovator instability installation instinct instinctive instinctively intellectually
  intensify intensity intensive interact interactive interference interpret interpretation interstellar interval
  interviewee intimacy inversely inversion ionosphere isolate isotope isotopic iteration journalism kilometer
  kleptoparasitism labyrinthine laureate lecture legendary lemur linear linguist linguistic lipid lithosphere
  lithospheric localized lunar lyrical macaque macroplankton macroscopic magma magnolia mammoth manifesto
  manipulate mantle manuscript marker masculinity materialism mathematician mathematics matrix maximize mechanic
  median meditation melancholy memoir mercantilism metaphor meteorite meter methodological methodology
  metropolis microbacteria microbes microbial microcrystalline microfracture microliter micromole microorganisms
  microscope microscopy migrate migration migratory millennia milligram milligrams millimeter millisecond mimosa
  mixtape mobility modernist modernity modify molybdenum monarch mongoose monopoly monopsony monument morally
  morphological motif motivate motivation motivator motive multicellular multicolored multidisciplinary
  multifaceted multinational multitask multitasking municipality mural mutation mycoprotein myth mythical
  mythological nanogram nanohybrid nanomaterial nanoparticles nationalist navigate navigation naïve nectar
  neural neuropsychologist neuroscience neuroscientist neurotransmitter neutral nonacting nonchanging noncoding
  noneconomic nonfermented nongravitational nonmaterial nonmigratory nonmuseum nonrecyclable nonspeech
  nontheatrical nonworking norm nucleotide nuclide observable observation observational observer obstruct
  obstruction oceanic optical optimistic orbit orchestra organism organizational orientation ornament
  ornamentation oscillating oxidation oxidative oxide oxygenation paleoanthropologist paleontologist
  paleontology panther paradigm paradoxical parameter parasite parsec passive passivity pause pedagogy pedal
  perfection performative performer perihelion periodically pharaoh phenomena phenomenon phenotype philosopher
  philosophical phlogiston phosphate phosphatidylinositol phosphine photochemical photosynthesis physiochemical
  physiological phytoplankton pigmentation pilgrim pioneer podium poet polar polarization polaron polymer
  polyploidy polyurethane populated portable portal portrait portray portrayal positively postindustrial
  pragmatic pragmatism prefix prefrontal prehistoric preindustrial printer privilege problematic progression
  progressively prolong proportion prose protoplanet provocative provoke pseudonym psychologist publicity python
  quantum quasiparticle quota radioactive radiocarbon radius randomized randomly react reactant receptor
  recipient recombinant recommendation recruit recyclable recycle reflection reflexively refrigeration
  regenerate regeneration regulate relevance relocate relocation replicate reproduce reproduction reproductive
  respectable respiration retailer reversible revolutionized revolutionizing risky ritual robotic rotate
  rotation rotational rotor rotunda runestone runic sacred satire satirical sauropod scenario sculpted sculptor
  sculptural seismic semiabstract sensor sensory shiitake silhouette silicate simulate simulation skater
  skeleton skeptical skepticism skeptics sketch slang socialization socially sociologist sociology sovereign
  sovereignty specialize spectrometry spectroscopy spherical sphinx spiral sponsor spray stagnant standardized
  static stationary statistical statue stimuli stimulus strategically stressful stressor strontium structural
  stylistic subatomic substance substrate subtype suffragist superfluorescence superfluorescent supernova
  symbolic symbolize symmetry synchronize synchronized syntax synthetic syrup tannin taxi technologist tectonic
  teenager telecommunication telescope televise tendency tentacles terrace tester textile texture theatrical
  theoretical theorist theorized thermal thermodynamic thermodynamics thermomechanical thermoplastic thesis
  titular tolerance tolerate tomato tomatoes topographic tourist toxicity toxin tracker trader traditionally
  tragedy trajectory transcribe transform transformation transformative transparency trigger trillion triumphal
  trope tropical trypsin turbine turbulence ultramarathon ultraviolet umami unify universally variation vary
  verbal verify vertical vertically vibration vintage visualize volcanic volcano volcanoes voyage zenith
  zoologist zooplankton
`.trim().split(/\s+/));

export const OBVIOUS = new Set([...PLAIN.trim().split(/\s+/), ...INTERNATIONAL]);

