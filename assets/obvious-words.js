// Words that are rare in everyday English but need no learning: numbers, plain forms of common words,
// compounds that say what they mean, international science words. Chosen by hand from the answer choices
// of the question bank. A list, not a rule: a rule on word parts would also take "hardship" and "overlook".
// Names, foreign words of a passage and broken forms are here too: they are no vocabulary to learn.
export const OBVIOUS = new Set(`
  eleventh twelfth thirteen thirteenth fourteen fourteenth fifteen fifteenth sixteen sixteenth seventeen
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

  aristotle plato thailand utah hanoi cherokee navajo guinea cupid
  meng mengsedih serga ikaah bree choy parachinensi explicacione mimesi mimos poema robota mtorolite fregata thale
  bufo jorō sōsaku hanga ukiyo styrene ethylene butylene raffinose bufadienolide jasmonic
`.trim().split(/\s+/));
