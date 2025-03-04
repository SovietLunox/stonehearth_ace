local validator = radiant.validator

local JobCallHandler = class()

function JobCallHandler:set_crafting_category_disabled(session, response, crafter, category, disabled)
   validator.expect_argument_types({'Entity', 'string'}, crafter, category)
   validator.expect.matching_player_id(session.player_id, crafter)

   local job_component = crafter:get_component('stonehearth:job')
   if job_component then
      job_component:set_crafting_category_disabled(category, disabled)
   end

   response:resolve({})
end

return JobCallHandler
