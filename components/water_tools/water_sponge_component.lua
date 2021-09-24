--[[
   contains a lot of the core functionality that was previously in the water_pump component
   but made more flexible
]]

local Point3 = _radiant.csg.Point3
local Cube3 = _radiant.csg.Cube3
local Region3 = _radiant.csg.Region3
local log = radiant.log.create_logger('water_sponge')

local WaterSpongeComponent = class()

function WaterSpongeComponent:initialize()
   self._json = radiant.entities.get_json(self)

   self._input_rate = self._json.input_rate or 0
   self._output_rate = self._json.output_rate or 0
   self._input_depth = self._json.input_depth or 0
   self._create_water = self._json.create_water
   self._destroy_water = self._json.destroy_water
   -- if the sponge is in absorb mode, disable once it's at full capacity; if in release mode, disable once it's empty
   self._auto_disable_on_full_or_empty = self._json.auto_disable_on_full_or_empty

   self._effects = {}
end

function WaterSpongeComponent:create()
   self._is_create = true

   if self._json.input_location then
      self._sv._input_location = radiant.util.to_point3(self._json.input_location)
   end
   if self._json.output_location then
      self._sv._output_location = radiant.util.to_point3(self._json.output_location)
   end

   self._sv.input_enabled = self._json.input_enabled ~= false
   self._sv.output_enabled = self._json.output_enabled ~= false
end

function WaterSpongeComponent:post_activate()
   self._container = self._entity:get_component('stonehearth_ace:container')

   --Trace the parent to figure out if it's added or not:
	self._parent_trace = self._entity:add_component('mob'):trace_parent('water sponge added or removed')
      :on_changed(function(parent_entity)
            if not parent_entity then
               --we were just removed from the world
               self:_shutdown()
            else
               --we were just added to the world
               self:_startup()
            end
         end)

   self._entity:remove_component('stonehearth:wet_stone')

   self:_startup()
end

function WaterSpongeComponent:destroy()
   if self._parent_trace then
      self._parent_trace:destroy()
      self._parent_trace = nil
   end
   self:_stop_effects()
end

function WaterSpongeComponent:_ensure_effect(condition, name, ...)
   if condition then
      self:_start_effect(name, self._json.effects[name], ...)
   else
      self:_stop_effect(name)
   end
end

function WaterSpongeComponent:_start_effect(name, effect, location, location_is_relative)
   if not self._effects[name] then
      local entity = self._entity
      if location then
         -- if this effect should happen at a separate location, make a proxy entity there
         entity = radiant.entities.create_entity('stonehearth:object:transient', { debug_text = name .. ' effect anchor' })
         
         -- assume the location is relative unless otherwise specified (e.g., input/output location)
         if location_is_relative ~= false then
            location = radiant.entities.get_world_grid_location(self._entity) + location:rotated(radiant.entities.get_facing(self._entity))
         end

         radiant.terrain.place_entity_at_exact_location(proxy, location)
      end

      self._effects[name] = radiant.effects.run_effect(entity, effect)
         :set_cleanup_on_finish(false)
   end
end

function WaterSpongeComponent:_stop_effect(name)
   if self._effects[name] then
      self._effects[name]:stop()
      self._effects[name] = nil
   end
end

function WaterSpongeComponent:_stop_effects()
   for _, effect in pairs(self._effects) do
      effect:stop()
   end
   self._effects = {}
end

function WaterSpongeComponent:_startup()
	local location = radiant.entities.get_world_grid_location(self._entity)
	if not location then
		return
	end

   stonehearth.hydrology:unregister_water_processor(self._entity:get_id(), self)
   stonehearth.hydrology:register_water_processor(self._entity:get_id(), self, location.y)
   self:_update_commands()
   self:_update_effects()
end

function WaterSpongeComponent:_shutdown()
   stonehearth.hydrology:unregister_water_processor(self._entity:get_id(), self)
   self:_update_effects()
end

function WaterSpongeComponent:get_input_rate()
   return self._sv._input_rate_override or self._input_rate
end

function WaterSpongeComponent:set_input_rate(rate)
   self._sv._input_rate_override = rate
end

function WaterSpongeComponent:get_output_rate()
   return self._sv._output_rate_override or self._output_rate
end

function WaterSpongeComponent:set_output_rate(rate)
   self._sv._output_rate_override = rate
end

function WaterSpongeComponent:get_input_location()
   return self._sv._input_location
end

function WaterSpongeComponent:set_input_location(location)
   self._sv._input_location = location
end

function WaterSpongeComponent:get_output_location()
   return self._sv._output_location, self._sv._output_origin
end

function WaterSpongeComponent:set_output_location(location, origin)
   self._sv._output_location = location
   self._sv._output_origin = origin
end

function WaterSpongeComponent:set_enabled(input, output)
   self._sv.input_enabled = input
   self._sv.output_enabled = output
   self.__saved_variables:mark_changed()

   self:_update_commands()
   self:_update_effects()
end

function WaterSpongeComponent:is_flow_enabled()
   return self._sv.input_enabled and self._sv.output_enabled
end

function WaterSpongeComponent:is_flow_disabled()
   return not self._sv.input_enabled and not self._sv.output_enabled
end

function WaterSpongeComponent:reset_processed_this_tick()
   self._processed_this_tick = false
end

function WaterSpongeComponent:on_tick_water_processor()
   if self._processed_this_tick then
      return
   end
   self._processed_this_tick = true

	if not self._sv.input_enabled and not self._sv.output_enabled then
		return
	end

	local location = radiant.entities.get_world_grid_location(self._entity)
	if not location then
		return
   end

   -- first try outputting what we have
   -- a pipe/pump/sponge will output from its container; a well will simply create water and not have a container

   local output_rate = self:get_output_rate()
   if self._sv.output_enabled and output_rate > 0 then
      local output_location = self._sv._output_location
      if output_location then
         output_location = location + output_location:rotated(radiant.entities.get_facing(self._entity))

         local destination_container, destination_sponge, is_solid = self:_get_destination_container(output_location)
         if destination_container then
            -- since we're outputting first, we want to process from the end of the line first
            -- that way our destination container will have as much space as it can before we try to output
            if destination_sponge then
               destination_sponge:on_tick_water_processor()
            end
            output_rate = math.min(output_rate, destination_container:get_available_capacity('stonehearth:water'))
         elseif is_solid then
            output_rate = 0
         end

         if not self._create_water then
            if self._container then
               -- if we're not creating water, it has to come from our container (which can get fed by input or by others' output)
               -- update the output_rate based on how much we actually have in the container
               output_rate = output_rate - self._container:remove_volume('stonehearth:water', output_rate)
            else
               output_rate = 0
            end
         end

         if output_rate > 0 then
            if destination_container then
               destination_container:add_volume('stonehearth:water', output_rate)
            else
               -- check if there's a water entity at the output location to add it to
               -- if not, check where we might want to make a waterfall
               -- if it makes sense to make a waterfall, do that, otherwise just output water
               local output_origin = self._sv._output_origin
               if output_origin then
                  output_origin = location + output_origin:rotated(radiant.entities.get_facing(self._entity))
                  local water = stonehearth.hydrology:get_water_body_at(output_location)
                  if not water then
                     local bottom = stonehearth.hydrology:get_terrain_below(output_location)
                     if output_location ~= bottom then
                        water = stonehearth.hydrology:get_or_create_water_body_at(bottom)
                        local channel_manager = stonehearth.hydrology:get_channel_manager()
                        local channel = channel_manager:add_waterfall_channel(output_origin, bottom, self._entity, water)
                        channel_manager:add_water_to_waterfall_channel(channel, output_rate)
                        output_rate = 0
                     end
                  end
               end

               if output_rate > 0 then
                  local volume_not_added = stonehearth.hydrology:add_water(output_rate, output_location, nil, true)
                  if volume_not_added > 0 and self._container then
                     -- if we couldn't add it all, put it back in our container if we have one
                     self._container:add_volume('stonehearth:water', volume_not_added)
                  end
               end
            end

            if self._auto_disable_on_full_or_empty and not self._sv.input_enabled and self._container and self._container:is_empty() then
               self:set_enabled(self._sv.input_enabled, false)
            end
         end
      end
   end

   -- then input water into our container (or destroy water if we don't have one and are set to destroy)

   local input_rate = self:get_input_rate()
   if self._sv.input_enabled and input_rate > 0 then
      if self._container then
         input_rate = math.min(input_rate, self._container:get_available_capacity('stonehearth:water'))
      elseif not self._destroy_water then
         input_rate = 0
      end

      if input_rate > 0 then
         local input_location = self._sv._input_location
         if input_location then
            input_location = location + input_location:rotated(radiant.entities.get_facing(self._entity))
            local volume_not_removed = input_rate

            -- pull water up from the lowest depth first
            for depth = self._input_depth, 0, -1 do
               local source_location = input_location + Point3(0, -depth, 0)
               local water_body = self:_get_water_body(source_location)

               if water_body then
                  -- try removing water from this depth
                  volume_not_removed = stonehearth.hydrology:remove_water(volume_not_removed, source_location, water_body, true)
               end

               if volume_not_removed <= 0 then
                  break
               end
            end

            input_rate = input_rate - volume_not_removed
            if self._container then
               if input_rate > 0 then
                  self._container:add_volume('stonehearth:water', input_rate)
                  
                  if self._auto_disable_on_full_or_empty and not self._sv.output_enabled and self._container:is_full() then
                     self:set_enabled(false, self._sv.output_enabled)
                  end
               end
            end
         end
      end
   end
end

function WaterSpongeComponent:_get_water_body(location)
	if not location then
		return nil
	end

	local entities = radiant.terrain.get_entities_at_point(location)

	for id, entity in pairs(entities) do
		local water_component = entity:get_component('stonehearth:water')
		if water_component then
			return entity
		end
	end

	return nil
end

function WaterSpongeComponent:_get_destination_container(location)
	if not location then
		return nil, false
	end

	local entities = radiant.terrain.get_entities_at_point(location)

   local container_component = nil
   local sponge_component = nil
	local is_solid = false

	for id, entity in pairs(entities) do
		local container = entity:get_component('stonehearth_ace:container')
		if container and container:get_type() == 'stonehearth:water' then
         container_component = container
         sponge_component = entity:get_component('stonehearth_ace:water_sponge')
         break
      end
      local rcs = entity:get_component('region_collision_shape')
		if rcs and rcs:get_region_collision_type() == _radiant.om.RegionCollisionShape.SOLID then
			is_solid = true
		end
	end

	return container_component, sponge_component, is_solid
end

-- when input/output is enabled/disabled, adjust commands accordingly
-- a pump will have two total commands but only a single command at a time: enable/disable both input and output
-- a sponge will have four total commands but two at a time: toggle mode (absorb/release) and toggle enabled
-- a "buffer" could have four separate commands with two at a time: enable/disable input and enable/disable output
function WaterSpongeComponent:_update_commands()
   local commands = self._json.commands
   if commands then
      local commands_comp = self._entity:add_component('stonehearth:commands')

      self:_ensure_command(not self:is_flow_enabled(), commands_comp, commands.enable_flow)

      self:_ensure_command(not self:is_flow_disabled(), commands_comp, commands.disable_flow)
   end
end

function WaterSpongeComponent:_ensure_command(condition, commands_comp, command)
   if command then
      if condition then
         commands_comp:add_command(command)
      else
         commands_comp:remove_command(command)
      end
   end
end

function WaterSpongeComponent:_update_effects()
   local effects = self._json.effects
   if effects then
      if effects.flow_enabled then
         self:_ensure_effect(self:is_flow_enabled(), 'flow_enabled')
      end

      if effects.flow_disabled then
         self:_ensure_effect(self:is_flow_disabled(), 'flow_disabled')
      end
   end
end

return WaterSpongeComponent
