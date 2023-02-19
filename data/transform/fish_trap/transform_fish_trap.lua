local log = radiant.log.create_logger('transform_fish_trap')

local transform_fish_trap = {}

function transform_fish_trap.start_transforming(entity, options, finish_cb)
   local fish_trap = entity:get_component('stonehearth_ace:fish_trap')
   if fish_trap then
      log:debug('starting raise fish trap for %s', entity)
      fish_trap:raise_trap(function()
         finish_cb()
         radiant.events.trigger_async(entity, 'stonehearth:clear_trap', {trapped_entity_id = true})
      end)
   end
end

return transform_fish_trap
