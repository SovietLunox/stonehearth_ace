local GotoOtherOwnedBed = radiant.class()

GotoOtherOwnedBed.name = 'go to bed'
GotoOtherOwnedBed.does = 'stonehearth_ace:goto_bed'
GotoOtherOwnedBed.args = {}
GotoOtherOwnedBed.priority = 0

function GotoOtherOwnedBed:start_thinking(ai, entity, args)
   self._entity_id = entity:get_id()
end

local function make_is_available_bed_filter()
   return stonehearth.ai:filter_from_key('stonehearth:rest_from_injuries:rest_in_bed', 'none', function(target)
         local bed_data = radiant.entities.get_entity_data(target, 'stonehearth:bed')
         if bed_data and not target:add_component('stonehearth:mount'):is_in_use() then
            local ownable_component = target:get_component('stonehearth:ownable_object')
            local owner = ownable_component:get_owner()
            if owner and owner:get_id() ~= self._entity_id then
               return true
            end
         end
         return false
      end)
end

local ai = stonehearth.ai
return ai:create_compound_action(GotoOtherOwnedBed)
         :execute('stonehearth:goto_entity_type', {
            filter_fn = make_is_available_bed_filter(),
            description = 'rest in other-owned bed'
         })
