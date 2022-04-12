--[[
   this component interfaces between the statistics component, the unit_info component,
   and population_faction to apply titles to entities based on statistics
]]

local TitlesComponent = class()

function TitlesComponent:initialize()
   self._sv.titles = {}
   self._sv.latest_title = {}
   self._sv.renown = 0
end

function TitlesComponent:activate()
   self._stats_listener = radiant.events.listen(self._entity, 'stonehearth_ace:stat_changed', self, self._on_stat_changed)
   self._settings_listener = radiant.events.listen(radiant, 'title_selection_criteria_changed', self, self._select_new_title)
end

function TitlesComponent:post_activate()
   -- population hasn't been fully set up yet apparently in activate, so have to call this here
   self._player_id_trace = self._entity:trace_player_id('titles')
      :on_changed(
         function ()
            self:update_titles_json()
         end
      )

   self:update_titles_json()

   -- if they have titles but renown is 0, this is probably the first load after renown was added; calculate it
   if self._sv.titles ~= {} and self._sv.renown == 0 then
      self:_recalculate_renown()
   end
end

function TitlesComponent:destroy()
   if self._stats_listener then
      self._stats_listener:destroy()
      self._stats_listener = nil
   end

   if self._settings_listener then
      self._settings_listener:destroy()
      self._settings_listener = nil
   end

   if self._player_id_trace then
      self._player_id_trace:destroy()
      self._player_id_trace = nil
   end
end

function TitlesComponent:get_titles()
   return self._sv.titles
end

function TitlesComponent:get_latest_title()
   return self._sv.latest_title
end

function TitlesComponent:get_renown()
   return self._sv.renown
end

-- used by reembarking
function TitlesComponent:set_titles(titles)
   self._sv.titles = titles or {}
   self:_recalculate_renown()
end

function TitlesComponent:_recalculate_renown()
   local renown = 0
   if self._sv.titles then
      for title, rank in pairs(self._sv.titles) do
         renown = renown + (self:get_title_renown(title, rank) or 0)
      end
   end
   self._sv.renown = renown
   self.__saved_variables:mark_changed()
end

function TitlesComponent:has_title(title, rank)
   local title_rank = self._sv.titles[title]
   return title_rank and (not rank or title_rank >= rank)
end

function TitlesComponent:get_highest_rank(title)
   return title and self._sv.titles[title]
end

function TitlesComponent:get_title_renown(title, rank)
   local population = stonehearth.population:get_population(self._entity:get_player_id())
   return population:get_title_renown(self._entity, title, rank)
end

function TitlesComponent:get_current_title_renown()
   local current_title = self._entity:add_component('stonehearth:unit_info'):get_current_title()
   return current_title and current_title.renown or 0
end

function TitlesComponent:get_highest_renown_title()
   local hr_title = {}
   local hr = 0
   for title, rank in pairs(self._sv.titles) do
      local renown = self:get_title_renown(title, rank)
      if renown >= hr then
         hr_title = { title = title, rank = rank }
      end
   end
   return hr_title
end

-- once bestowed, a title is never removed; it can only be increased in rank
function TitlesComponent:add_title(title, rank)
   if not self:has_title(title, rank) then
      self._sv.titles[title] = rank or 1
      self._sv.latest_title = { title = title, rank = rank }
      self._sv.renown = self._sv.renown + (self:get_title_renown(title, rank) - (self:get_title_renown(title, (rank - 1)) or 0))
      self.__saved_variables:mark_changed()

      -- update component info details
      self:_update_component_info()

      self:_select_new_title(nil, title, rank)
		
		if stonehearth.client_state:get_client_gameplay_setting(self._entity:get_player_id(), 'stonehearth_ace', 'show_new_title_notification', true) then
			self:_show_bulletin(title, rank)
		end
   end
end

function TitlesComponent:_update_component_info()
   -- what's the best way to do this? probably offload the work (building table of all the ranks' i18n data) onto the client if possible
   self._entity:add_component('stonehearth_ace:component_info'):set_component_detail('stonehearth_ace:titles', 'titles', {
         type = 'title_list',
         titles = self._sv.titles,
         titles_json = self._sv.titles_json,
         header = 'stonehearth_ace:component_info.stonehearth_ace.titles.all_earned_titles'
      }, {})
end

function TitlesComponent:_select_new_title(criteria_change, title, rank)
   if stonehearth.client_state:get_client_gameplay_setting(self._entity:get_player_id(), 'stonehearth_ace', 'auto_select_new_titles', true) then
      local criteria 
      if not criteria_change then
         criteria = stonehearth.client_state:get_client_gameplay_setting(self._entity:get_player_id(), 'stonehearth_ace', 'title_selection_criteria')
      end

      if criteria_change and criteria_change == 'latest' or criteria == 'latest' then
         if self._sv.latest_title then
            self:_set_new_title(self._sv.latest_title['title'], self._sv.latest_title['rank'])
         end
      elseif criteria_change and criteria_change == 'highest_renown' or criteria == 'highest_renown' then
         if criteria_change then
            local hr_title = self:get_highest_renown_title()
            self:_set_new_title(hr_title['title'], hr_title['rank'])
         elseif title and rank then
            if self:get_current_title_renown() <= self:get_title_renown(title, rank) then
               self:_set_new_title(title, rank)
            end
         end
      else
         if title and rank then
            self:_set_new_title(title, rank)
         end
      end
   end
end

function TitlesComponent:_set_new_title(title, rank)
   local unit_info = self._entity:add_component('stonehearth:unit_info')
   unit_info:ensure_custom_name()

   unit_info:select_title(title, rank)
end

function TitlesComponent:_on_stat_changed(args)
   local population = stonehearth.population:get_population(self._entity:get_player_id())
   if population then
      local titles = population:get_titles_for_statistic(self._entity, args)
      if titles then
         for title, rank in pairs(titles) do
            self:add_title(title, rank)
         end
      end
   end
end

function TitlesComponent:update_titles_json()
   local pop = stonehearth.population:get_population(self._entity:get_player_id())
   local titles_json = pop and pop:get_titles_json_for_entity(self._entity)
   if titles_json ~= self._sv.titles_json then
      self._sv.titles_json = titles_json
      self.__saved_variables:mark_changed()
   end
end

function TitlesComponent:_show_bulletin(title, rank)
   -- alert the player that they gained a title
   local player_id = self._entity:get_player_id()
   local pop = stonehearth.population:get_population(player_id)
   local is_citizen = pop and pop:is_citizen(self._entity)
   local message = is_citizen and 'i18n(stonehearth_ace:ui.game.bulletin.achievement_acquired_bulletin.new_title.message)'
                     or 'i18n(stonehearth_ace:ui.game.bulletin.achievement_acquired_bulletin.new_title.item_message)'

   local bulletin = stonehearth.bulletin_board:post_bulletin(player_id)
      :set_ui_view('StonehearthAceAchievementAcquiredBulletinDialog')
      :set_callback_instance(self)
      :set_type('achievement')
      :set_data({
         title = 'i18n(stonehearth_ace:ui.game.bulletin.achievement_acquired_bulletin.new_title.title)',
         header = 'i18n(stonehearth_ace:ui.game.bulletin.achievement_acquired_bulletin.new_title.header)',
         message = message,
         zoom_to_entity = self._entity,
         has_character_sheet = is_citizen
      })
      :set_active_duration('1h')
      :add_i18n_data('entity', self._entity)
      --:add_i18n_data('old_name', old_name)
      :add_i18n_data('new_title', pop and pop:get_title_rank_data(self._entity, title, rank) or {})

   return bulletin
end

return TitlesComponent