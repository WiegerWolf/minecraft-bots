- [x] as landscaper breaks dirt while gathering resources, she needs to make sure that she actually collects the dirt blocks she broke
  - Fixed in `GatherDirt.ts`: Added `collectNearbyDrops()` method that finds dropped items near dig position and walks over them to collect

- [x] landscaper should dig dirt blocks to collect them while gathering resources away from the farm or the forest or any other established resources. ideally, she should dig in a relative far location from the village center away from any other established resources. she should look for a location that has a relative high dirt block density and establish it as a new resource place, like a dirtpit or something. the resource location establishment should be permanent and the landscaper should always dig in and around that location, she should also put a sign at the spawn area of the dirtpit to mark it as a resource location, so others can learn about it
  - Implemented:
    - Added `DIRTPIT` as new sign knowledge type in `SignKnowledge.ts`
    - Added `dirtpit` and `hasDirtpit` fields to `LandscaperBlackboard.ts`
    - Created `EstablishDirtpit.ts` action that:
      - Finds areas with high dirt density (>40% of sampled blocks)
      - Avoids village center (>50 blocks), farms (>30 blocks), forests (>20 blocks)
      - Establishes the location and optionally places a DIRTPIT sign
    - Modified `GatherDirt.ts` to prefer gathering from established dirtpit
    - Added `EstablishDirtpitGoal` with utility 55 (higher than GatherDirt 30-50)
    - Landscaper reads DIRTPIT signs from spawn in `StudySpawnSigns.ts`

- [ ] bots should prioritize solving their needs through trading with each other, if someone is offering something that someone else needs, they should trade it even if at the moment they are preoccupied with something else. same goes for providing resources to other bots that need them. trading should be a priority over other activities, like gathering resources or building
