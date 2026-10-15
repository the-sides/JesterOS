// Original offline fiction. Publishers, people, places and reporting are invented.
export const NEWS_CHANNELS = [
  { id: 'harbor-ledger', name: 'Harbor Ledger', regions: ['US'], color: '#b73738' },
  { id: 'borough-review', name: 'Borough Review', regions: ['UK'], color: '#324f73' },
  { id: 'southern-post', name: 'Southern Post', regions: ['AU'], color: '#ad7131' },
  { id: 'northern-journal', name: 'Northern Journal', regions: ['CA'], color: '#427467' },
  { id: 'field-notes', name: 'Field Notes', regions: ['US', 'UK', 'AU', 'CA'], color: '#69774c' },
];
export const NEWS_TOPICS = [{ id: 'community', name: 'Community' }, { id: 'science', name: 'Science' }, { id: 'culture', name: 'Culture' }, { id: 'business', name: 'Business' }];
const rows = [
  ['us-library','harbor-ledger',['US'],'community','A little library makes room for a whole neighborhood','Mara Ellis',[
    'The fictional town of Alder Bay opened its renovated branch library on Monday, turning a former storage room into a bright workshop for residents. The project cost $84,000, funded by a local community trust rather than a new tax levy.',
    'Librarian June Vale said the room would host repair afternoons, reading groups and free homework sessions. Volunteers built movable tables so the same space could accommodate a dozen students in the afternoon and a larger public meeting in the evening.',
    'Visitors will not need a library card to attend. The first repair afternoon is scheduled for Saturday, with volunteers offering help with torn clothing and loose chair joints. Electrical appliances will not be accepted because the team does not yet have a qualified repair supervisor.',
    'The library will publish attendance figures after its first three months. Vale said the measure of success was simple: whether neighbors who had never met before would return to work on something together.'
  ]],
  ['us-ferry','harbor-ledger',['US'],'business','Harbor ferry tests a quieter morning timetable','Theo Ames',[
    'Alder Bay Ferry Cooperative has moved its first weekday departure fifteen minutes earlier for a six-week trial. The fictional operator says the change responds to shift workers who previously arrived after their workplaces opened.',
    'The cooperative carries about 240 passengers each weekday. Fares remain $3 per trip, and the trial uses the existing boat and crew rather than adding a vessel. The later morning departure has moved by the same interval, leaving the number of sailings unchanged.',
    'Passengers can leave written feedback at either terminal. The cooperative will compare ridership and missed connections before deciding whether to keep the schedule. No weekend changes are planned.'
  ]],
  ['uk-market','borough-review',['UK'],'community','Market hall returns with space for independent makers','Iona Reed',[
    'The fictional borough of Merewick reopened its covered market after a four-month roof repair. Twenty stallholders returned beneath restored iron trusses, while four smaller tables were set aside for first-time traders.',
    'The repair cost £126,000 from the borough maintenance budget. Market manager Ellis Ward said the new tables would be let by the day for £12, allowing makers to test demand without signing a long lease.',
    'A local ceramics group booked the first Saturday session. Its members plan to show how they repair cracked display pieces instead of discarding them. The demonstration is free, but visitors should bring neither valuable antiques nor damaged electrical goods.',
    'The hall opens from eight until four on market days. The borough will review access arrangements with stallholders before winter, including whether the delivery entrance needs a second handrail.'
  ]],
  ['uk-stage','borough-review',['UK'],'culture','A small theatre puts the audience around the story','Nell Hart',[
    'Merewick Studio has rearranged its sixty-seat auditorium for an original play about neighbors sharing a garden. The fictional production, The Last Gate, uses a central stage with audience members on three sides.',
    'Director Robin Ash said the arrangement allowed quiet conversations to feel close without amplification. The set consists of two benches, a doorframe and pots borrowed from the theatre workshop; no live plants will be moved during a performance.',
    'Tickets cost £9, with six pay-what-you-can seats at each show. The run lasts two weekends. An afternoon performance includes a relaxed interval, and the box office can describe the step-free entrance to anyone planning a visit.'
  ]],
  ['au-shade','southern-post',['AU'],'community','New shade trees turn a hot walkway into a meeting place','Luca Wren',[
    'Residents of fictional Banksia Reach planted eighteen young trees along the walkway between their library and recreation ground. The planting followed a community mapping exercise in which volunteers recorded the places where pedestrians stopped to escape the afternoon sun.',
    'The council allocated A$22,000 for planting, guards and two years of watering. Parks coordinator Ada Finch said the saplings would not provide significant shade immediately, so temporary fabric shelters would stay in place through the coming summer.',
    'Volunteers will inspect the guards each month, but council staff remain responsible for watering. Residents have been asked not to attach swings or signs to the young trees.',
    'A bench beside the library is already being used for a weekly seed swap. Organizers said the project was about a slower, more comfortable walk rather than a promise to solve the town’s heat problems on its own.'
  ]],
  ['au-repair','southern-post',['AU'],'business','Repair workshop gives retired tools another working life','Pia Moss',[
    'A small cooperative in Banksia Reach has begun lending hand tools restored by volunteer carpenters. The fictional workshop started with forty donated items, including clamps, planes and garden forks.',
    'Membership costs A$15 a year. Each tool is inspected before lending, and powered equipment is excluded until the cooperative can arrange professional testing. Borrowers receive a short handling demonstration and a printed return date.',
    'Organizer Finn Lowe said the aim was to help households complete occasional jobs without buying equipment they would rarely use. The workshop will review its lending records after three months before accepting further donations.'
  ]],
  ['ca-rink','northern-journal',['CA'],'community','Community rink prepares a warmer welcome off the ice','Eden Brooks',[
    'The fictional town of Pine Crossing has renovated the warming room beside its outdoor rink. The C$31,000 project added insulated benches, a drinking-water tap and a wider doorway, while leaving the skating surface unchanged.',
    'Recreation coordinator Avery Lake said the room would open whenever supervised skating sessions operated. Visitors who do not skate can use it too, and a volunteer group will run a weekly board-game afternoon.',
    'Opening dates still depend on safe ice conditions. Staff will post inspection results at the entrance rather than promising a fixed start to the season. The town has asked residents to stay off the surface until the supervision sign is displayed.'
  ]],
  ['ca-makers','northern-journal',['CA'],'culture','Winter makers exchange stories as well as patterns','Rowan Bell',[
    'Pine Crossing’s fictional textile circle is assembling a community quilt from small donated squares. Each contributor writes a short note about a place important to them, and those notes will be displayed beside the finished work.',
    'The group meets in the town hall twice a month. Materials are supplied free from existing donations; participants do not need sewing experience. Organizers are asking for washed cotton rather than expensive fabric.',
    'The quilt will stay in the hall instead of being sold. A large-print booklet of the contributors’ notes will be available at the library, with permission requested separately for every story.'
  ]],
  ['all-stream','field-notes',['US','UK','AU','CA'],'science','Listening to a stream without disturbing its banks','Sam Hollis',[
    'At the fictional Willow Field research station, a team is testing whether short sound recordings can help volunteers notice changes in a stream. The pilot compares recordings made from a bridge with observations written down at the same time.',
    'Researcher Kit Morgan said louder water did not automatically mean a healthier stream. Rainfall, wind and traffic can all change a recording, so the team keeps weather notes and does not treat the sound as a substitute for water sampling.',
    'Volunteers use a fixed observation point to avoid trampling the bank. The current project involves six visits and no animals are caught. Its first report will describe the method and its limitations, not claim a universal way to measure river health.',
    'The team hopes the exercise will make repeated observation easier for local groups. Even an unsuccessful test, Morgan said, could help explain which questions a simple recording cannot answer.'
  ]],
  ['all-paper','field-notes',['US','UK','AU','CA'],'culture','Why a folded sheet can change the way we read','Alex Fen',[
    'A fictional exhibition at the Small Works Room explores books made from a single folded sheet. Visitors can unfold a map-like poem, turn through a miniature story and compare two versions of the same drawing arranged in different sequences.',
    'Curator Jules North said the exhibition focused on reading as a physical act rather than on rare or valuable objects. Every display copy can be handled, and replacement copies were made before the opening.',
    'An accompanying workshop uses plain recycled paper. Participants are invited to write a complete six-line story, then decide where each fold should place the next line. Admission and materials are free, with reservations requested only for the small workshop tables.'
  ]],
];
export function createNewsArticles(sceneTime) {
  return rows.map(([id, channelId, regions, topic, title, author, paragraphs], index) => ({ id, channelId, regions: [...regions], topicIds: [topic], title, summary: paragraphs[0], paragraphs: [...paragraphs], author, publishedAt: Math.max(0, sceneTime - index * 3600000), revision: 1, explicit: false }));
}
