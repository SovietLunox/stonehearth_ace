var _cachedJobIndexes = {};

$(document).ready(function() {
   $(top).on("radiant_promote_to_job", function(_, e) {
      App.stonehearthClient.showPromotionTree(e.entity);
   });
});

App.StonehearthPromotionTree = App.View.extend({
   templateName: 'promotionTree',
   classNames: ['flex', 'fullScreen', 'exclusive'],
   closeOnEsc: true,

   init: function() {
      this._super();
      // Constant job data for icon display
      var jobArray = radiant.map_to_array(App.jobConstants);
      this.set('allJobData', jobArray);
      this._baseWorkerJob = App.constants.job.DEFAULT_BASE_JOB;
   },

   didInsertElement: function() {
      var self = this;

      this.$().draggable({ handle: '.title' });

      radiant.call('radiant:play_sound', {
         'track': 'stonehearth:sounds:ui:promotion_menu:scroll_open'
      });
      this._super();

      var self = this;

      self._addHandlers();

      radiant.call_obj('stonehearth.inventory', 'get_item_tracker_command', 'stonehearth:basic_inventory_tracker')
         .done(function(response) {
            var itemTraces = {
               "tracking_data": {
                  "*": {
                  }
               }
            };

            self._playerInventoryTrace = new StonehearthDataTrace(response.tracker, itemTraces)
               .progress(function (response) {
                  if (self.isDestroyed || self.isDestroying) return;
                  self.set('inventory_data', response.tracking_data);
               });
         })
         .fail(function(response) {
            console.error(response);
         });

      self._getJobIndex();
   },

   willDestroyElement: function() {
      this.$().find('.node').off('click');
      this.$('#approveStamper').off('click');
      this._super();
   },

   dismiss: function () {
      radiant.call('radiant:play_sound', {
         'track': 'stonehearth:sounds:ui:start_menu:page_down'
      });

      this.set('citizen', null);
      this.set('job_index', null);

      this._clearSettings();

      var index = App.stonehearth.modalStack.indexOf(this)
      if (index > -1) {
         App.stonehearth.modalStack.splice(index, 1);
      }

      this.hide();
   },

   show: function (citizen, job_index) {
      this._super();

      App.stonehearth.modalStack.push(this);
      this._clearSettings();
      this.set('citizen', citizen);
      this.set('job_index', job_index);
      this._getJobIndex();
   },

   _clearSettings: function () {
      this._jobData = null;

      if (this._jobsTrace) {
         this._jobsTrace.destroy();
         this._jobsTrace = null;
      }

      if (this._citizenTrace) {
         this._citizenTrace.destroy();
         this._citizenTrace = null;
      }
   },

   getParentJobs: function(jobDescription) {
      var self = this;
      var parents = jobDescription.parent_jobs || [{"job": jobDescription.parent_job, "level_requirement": jobDescription.parent_level_requirement}];
      var parentJobs = [];
      var oneOf = [];
      var hadParent = false;
      parents.forEach(parentJob => {
         if (parentJob.job) {
            hadParent = true;
            if (self._isValidJob(parentJob.job)) {
               var job = {"job": parentJob.job, "level_requirement": parentJob.level_requirement || 0, "one_of": parentJob.one_of};
               if (parentJob.one_of) {
                  oneOf.push(job);
               }
               parentJobs.push(job);
            }
         }
      });
      if (oneOf.length == 1) {
         // if there's only one parent marked as "one of" then it's effectively mandatory
         oneOf[0].one_of = false;
      }
      // if we're left with no parents, but we originally had some that just aren't available, make the base worker job our parent
      if (parentJobs.length < 1 && hadParent) {
         parentJobs.push({"job": self._baseWorkerJob});
      }
      return parentJobs;
   },

   _isValidJob: function(alias) {
      var self = this;
      var job = alias && self._jobData && self._jobData[alias]
      return job && job.description && job.description.enabled;
   },

   // Transform the job data map into a tree for use by D3.
   // ACE: handle multiple job parents
   _buildTreeData: function() {
      var self = this;

      var arr = radiant.map_to_array(self._jobData, function(alias, job) {
         return self._isValidJob(alias) && (job.description.display_order || job.description.display_order == 0) ? job : false;
      });
      arr.sort(function(a, b) {
         return a.description.display_order - b.description.display_order;
      });

      // for all jobs in the map
      var root;
      var nodeMap = {};
      var additionalParents = [];
      radiant.each(arr, function(i, job) {
         //console.log('Job: ' + job.description.alias + ' enabled:' + job.description.enabled + ' order:'+ job.description.display_order +
         //  ' parent:' + job.description.parent_job);
         var key = job.description.alias;
         // lookup the node, building it as needed.
         var node = nodeMap[key] || {};
         nodeMap[key] = node;

         self._buildTreeNode(node, job);

         var parentJobs = self.getParentJobs(job.description);
         if (parentJobs.length > 0) {
            var parent = parentJobs[0];
            var parentNode = nodeMap[parent.job] || {};
            nodeMap[parent.job] = parentNode;

            // add this node as a child
            parentNode.children = parentNode.children || [];
            parentNode.children.push(node);
            
            for(var i=1; i<parentJobs.length; i++) {
               parent = parentJobs[i];
               // for now, just put a reference to the parent
               additionalParents.push({"child": node, "parent": parent.job, "one_of": parent.one_of});
            }
         }
         else {
            root = node;
         }
      });

      // now that we've processed all the nodes, we can go back and fill in the additionalParents parent references
		var realParents = [];
      additionalParents.forEach(nodePair => {
         nodePair.parent = nodeMap[nodePair.parent];
			if (nodePair.parent && nodePair.child) {
            realParents.push(nodePair);
         }
      });

      root.additionalParents = realParents;
      return root;
   },

   _buildTreeNode: function(node, job) {
      if (job.description.enabled == "in-progress") {
         job.description.set('name', "???");
         job.description.set('display_name', "???"); // why does this turn into an ember object?
         job.description.set('description', "???");
         job.description.set('requirements', "???");
         job.description.set('icon', "/stonehearth/jobs/unknown/images/icon.png");
         job.available = false;
      }

      node.name = job.description.name;
      node.description = job.description.description;
      node.icon = job.description.icon;
      node.alias = job.description.alias;
      node.available = job.available;
   },

   // ACE: handle multiple job parents and base jobs other than worker
   _buildTree: function(treeData) {
      var self = this;

      var margin = {
            left: 0,
            top: 50,
            right: 0,
            bottom: 40
         },
         width = 978 - margin.left - margin.right - 4 - 4,
         height = 468 - margin.top - margin.bottom - 4 - 4;

      var tree = d3.layout.tree()
         .separation(function(a, b) {
            return a.parent === b.parent ? 1 : 1.2;
         })
         .children(function(d) {
            return d.children;
         })
         .size([width, height]);

      var svg = d3.select(self.$('#content')[0])
         .append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
         .append("g")
            .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

      var grayscaleFilter = svg.append("filter");
      grayscaleFilter.attr("id", "greyscale");
      grayscaleFilter.append("feColorMatrix")
                     .attr("type", "saturate")
                     .attr("values", "0.1");

      var nodes = tree.nodes(treeData);

      var node = svg.selectAll(".node")
         .data(nodes)
         .enter()
         .append("g")
         .attr('id', function(d) {
            return d.alias
         })
         .attr('class', 'node')
         .on("mousedown", function(d) {
            self._updateUi(d.alias);
            //d3.select(this)
            //.attr('class', 'selected');
         });

      node.append('image')
         .attr('xlink:href', function(d) {
            return d.available ? '/stonehearth/ui/game/promotion_tree/images/jobButton.png' : '/stonehearth/ui/game/promotion_tree/images/jobButtonUnavailable.png'
         })
         .attr("x", function(d) {
            return d.x - 37;
         })
         .attr("y", function(d) {
            return height - d.y - 37;
         })
         .attr('width', 74)
         .attr('height', 74);

      node.append('image')
         //.attr('xlink:href', 'images/jobButton.png')
         //.attr('xlink:href', '/stonehearth/ui/game/promotion_tree/images/jobButton.png')
         .attr('xlink:href', function(d) {
            return d.icon
         })
         .attr('class', function(d) {
            return d.available ? "available" : "unavailable"
         })
         .attr('filter', function(d) {
            return d.available ? "" : "url(#greyscale)";
         })
         .attr("x", function(d) {
            return d.x - 37;
         })
         .attr("y", function(d) {
            return height - d.y - 37;
         })
         .attr('width', 74)
         .attr('height', 74);

      node.append("text")
         .attr("font-size", "14px")
         .attr("fill", "#ffc000")
         .attr('filter', function(d) {
            return (d.alias == self._startingJob) ? "" : "url(#greyscale)";
         })
         .attr("x", function(d) { return d.x + 12; })
         .attr("y", function(d) { return height - d.y + 56; })
         .text(function (d) {
            if (!self._citizenJobData || !d.alias) return;
            var citizenJob = self._citizenJobData[d.alias];
            var level = citizenJob ? citizenJob.last_gained_lv : -1;
            if (level >= 0 && d.alias != self._baseWorkerJob) {
               return i18n.t('stonehearth:ui.game.citizen_character_sheet.level_abbreviation') + " " + level;
            } else {
               return "";
            }
         });

      /* some example code, cause d3 is a strange beast
      node.append("rect")
          .attr("width", 140)
          .attr("height", 80)
          .attr("fill", "tan")
          .attr("x", function(d) { return d.x - 70; })
          .attr("y", function(d) { return height - d.y - 40; });

      node.append("text")
          .attr("font-size", "16px")
          .attr("fill", "black")
          .attr("x", function(d) { return d.x; })
          .attr("y", function(d) { return height - d.y - 15; })
          .style("text-anchor", "middle")
          .text(function(d) { return d.name; });

      node.append("text")
          .attr("font-size", "12px")
          .attr("x", function(d) { return d.x; })
          .attr("y", function(d) { return 10 + height - d.y; })
          .style("text-anchor", "middle")
          .text(function(d) { return d.born + "–" + d.died; });

      node.append("text")
          .attr("font-size", "11px")
          .attr("x", function(d) { return d.x; })
          .attr("y", function(d) { return 28 + height - d.y; })
          .style("text-anchor", "middle")
          .text(function(d) { return d.location; });
       */

      var nodeUpdate = node.transition()
         .duration(250);

      nodeUpdate.select('image')
         .attr('class', function(d) {
            return d.name == self._selectedName ? 'selected' : '';
         })
         .text(function(d) {
            return d.name == self._selectedName ? 'selected' : d.name;
         });

      var link = svg.selectAll(".link")
         .data(tree.links(nodes))
         .enter()
         .insert("path", "g")
         .attr("fill", "none")
         .attr("stroke", "#fff")
         .attr("stroke-width", 2)
         .attr("shape-rendering", "crispEdges")
         .attr("d", function(d, i) {
            return "M" + d.source.x + "," + (height - d.source.y) + "V" + (height - (3 * d.source.y + 4 * d.target.y) / 7) + "H" + d.target.x + "V" + (height - d.target.y);
         });

      svg.append("svg:defs").append("svg:marker")
         .attr("id", "arrow")
         .attr("viewBox", "0 0 10 10")
         .attr('refX', 4)
         .attr('refY', 4)
         .attr("markerWidth", 8)
         .attr("markerHeight", 8)
         .attr("orient", "auto")
         .attr("fill", "#fff")
      .append("svg:path")
         .attr("d", "M0,0L8,4L0,8");
    
      var depth = 48;
      treeData.additionalParents.forEach(nodePair => {
         if (Math.abs(nodePair.parent.y - nodePair.child.y) < 5) {
            var xDist = (nodePair.child.x - nodePair.parent.x) / 8
            var yLvl = (height - (nodePair.parent.y - depth));
            depth += 8;
            svg.insert("path", "g")
               .attr("fill", "none")
               .attr("stroke", "#fff")
               .attr("stroke-width", 2)
               .attr("stroke-dasharray", function() {
                  return nodePair.one_of ? "8,8" : "8,0";
               })
               //.attr("shape-rendering", "crispEdges")
               .attr("d", function() {
                  // if they're at the same y-level, make a "detour" dependent on the x-distance
                  
                  return "M" + nodePair.parent.x + "," + (height - nodePair.parent.y) + 
                         "L" + (nodePair.parent.x + xDist) + "," + yLvl;
               });
            svg.insert("path", "g")
               .attr("fill", "none")
               .attr("stroke", "#fff")
               .attr("stroke-width", 2)
               .attr("stroke-dasharray", function() {
                  return nodePair.one_of ? "8,8" : "8,0";
               })
               //.attr("shape-rendering", "crispEdges")
               .attr("marker-mid", (d) => "url(#arrow)")
               .attr("d", function() {
                  // if they're at the same y-level, make a "detour" dependent on the x-distance
                  
                  return "M" + (nodePair.parent.x + xDist) + "," + yLvl +
                         "L" + (nodePair.parent.x + xDist * 4) + "," + yLvl +
                         "L" + (nodePair.parent.x + xDist * 7) + "," + yLvl;
               });
            svg.insert("path", "g")
               .attr("fill", "none")
               .attr("stroke", "#fff")
               .attr("stroke-width", 2)
               .attr("stroke-dasharray", function() {
                  return nodePair.one_of ? "8,8" : "8,0";
               })
               //.attr("shape-rendering", "crispEdges")
               .attr("d", function() {
                  // if they're at the same y-level, make a "detour" dependent on the x-distance
                  
                  return "M" + (nodePair.parent.x + xDist * 7) + "," + yLvl +
                         "L" + nodePair.child.x + "," + (height - nodePair.child.y);
               });
         }
         else {
            svg.insert("path", "g")
               .attr("fill", "none")
               .attr("stroke", "#fff")
               .attr("stroke-width", 2)
               .attr("stroke-dasharray", function() {
                  return nodePair.one_of ? "8,8" : "8,0";
               })
               //.attr("shape-rendering", "crispEdges")
               .attr("marker-mid", (d) => "url(#arrow)")
               .attr("d", function() {
                  // otherwise just do a straight diagonal line in the middle
                  return "M" + nodePair.parent.x + "," + (height - nodePair.parent.y) + 
                        "L" + ((nodePair.parent.x + nodePair.child.x) / 2) + "," + (height - ((nodePair.parent.y + nodePair.child.y) / 2)) +
                        "L" + nodePair.child.x + "," + (height - nodePair.child.y);
               });
         }
      });
   },

   // ACE: also trace the properties to track if the selected citizen has their job locked
   _getCitizenData: function() {
      var self = this;
      var citizenId = this.get('citizen');

      // Get the info for the citizen.
      self._citizenTrace = new StonehearthDataTrace(citizenId, {
         'stonehearth:job': {
            'job_controllers': {
               '*': {}
            },
            'allowed_jobs': {}
         },
         'stonehearth:unit_info': {},
         'stonehearth:properties': {},
      });

      // Finally, build the tree.
      self._citizenTrace.progress(function(o) {
         if (self.isDestroyed || self.isDestroying) {
            return;
         }
         if (self._citizenTrace) {
            self._citizenTrace.destroy();
            self._citizenTrace = null;
         }

         var props = o['stonehearth:properties'];
         var jobLocked = props && props.properties['job_locked'] || false;
         self.set('jobLocked', jobLocked);
         self.set('jobLockedTitle', jobLocked && i18n.t('stonehearth_ace:ui.game.promotion_tree.job_locked') || '');
         self._startingJob = o['stonehearth:job'].job_uri;
         self._citizenJobData = o['stonehearth:job'].job_controllers;
         self._citizenAllowedJobs = o['stonehearth:job'].allowed_jobs;
         self.set('selectedJobAlias', self._startingJob);
         self._updateTalismanData();
         self.set('citizen', o);
      })
   },

   _getJobIndex: function() {
      var self = this;
      var citizen = self.get('citizen');
		
      var finishedGettingJobs = function (jobData) {
         self._jobData = jobData.jobs;
         if (jobData.base_job) {
            self._baseWorkerJob = jobData.base_job;
         }
         self._getCitizenData();
         //console.log("finished getting jobs");
      };

      var finishedGettingJobIndex = function (jobIndex) {
         if (_cachedJobIndexes[jobIndex]) {
            finishedGettingJobs(_cachedJobIndexes[jobIndex]);
         }
         else {
            var components = {
               "jobs": {
                  "*": {
                     "description": {}
                  }
               }
            };
            self._jobsTrace = new StonehearthDataTrace(jobIndex, components);
            self._jobsTrace.progress(function(eobj) {
               if (self.isDestroyed || self.isDestroying) {
                  return;
               }
               self._jobsTrace.destroy();
					_cachedJobIndexes[jobIndex] = eobj;
               finishedGettingJobs(eobj);
            });
			}
      }

      var index = self.get('job_index');
      if (index) {
         finishedGettingJobIndex(index);
      }
      else {
         radiant.call_obj('stonehearth.player', 'get_job_index', citizen)
            .done(function(response){
               if (self.isDestroyed || self.isDestroying) {
                  return;
               }
               finishedGettingJobIndex(response.job_index);
            })
            .fail(function(response) {
               console.error('error getting job index');
            });
      }
   },

   // ACE: override to handle talisman uri arrays
   _updateTalismanData: function() {
      var self = this;

      // If we dont' yet have the job data, bail, we will call this again when
      // we get the job data
      if (!self._jobData) {
         return;
      }

      // For each job, determine if it's available based on the tools that are
      // in the world.
      var inventory_data = self.get('inventory_data');
      if (inventory_data) {
         if (self.$('#content')[0]) {
            self.$('#content').empty();
            self._jobCursor = null;
         }

         radiant.each(self._jobData, function(jobAlias, jobData) {
            jobData.available = false;
            if (jobData.description) {
               var talismanUris = jobData.description.talisman_uris || {[jobData.description.talisman_uri] : true};
               jobData.talismanAvailable = null;
               if (talismanUris) {
                  radiant.each(talismanUris, (uri, enabled) => {
                     if (jobData.talismanAvailable) {
                        return;
                     }
                     if (enabled) {
                        jobData.talismanAvailable = jobData.talismanAvailable || false;
                        if (inventory_data[uri] && inventory_data[uri].first_item) {
                           jobData.talismanAvailable = true;
                           var requirementsMet = self._calculateRequirementsMet(jobAlias);
                           if (requirementsMet) {
                              jobData.available = true;
                           }
                           return;
                        }
                     }
                  });
               }
            }
         });

         var workerJob = self._jobData[self._baseWorkerJob];
         if (workerJob) {
            workerJob.available = true;
         }

         // Filter down allowed jobs, if there's a whitelist.
         if (self._citizenAllowedJobs) {
            var filteredJobData = {};
            radiant.each(self._jobData, function (jobAlias, jobData) {
               if (self._citizenAllowedJobs[jobAlias]) {
                  filteredJobData[jobAlias] = jobData;
               }
            });
            self._jobData = filteredJobData;
         }

         var treeData = self._buildTreeData(self._jobData);
         self._buildTree(treeData);
         if (self.get('selectedJobAlias')) {
            self._updateUi(self.get('selectedJobAlias'))
         }
      }
   }.observes('inventory_data'),

   _addHandlers: function() {
      var self = this;

      self.$('#approveStamper').click(function() {
         if (self._promote(self.get('selectedJobAlias'))) {
            self._animateStamper();
         }
      })
   },

   // ACE: handle multiple job parents and non-worker base job
   _updateUi: function(jobAlias) {
      var self = this;
      var jobEl = $(document.getElementById(jobAlias)); // use getElementById because jobAlias contains colons

      // Move the selection cursor.
      if (!self._jobCursor) {
         self._jobCursor = $('<div>')
            .addClass('cursor')
            .appendTo(self.$('#content'));
      }

      var imgEl = $(jobEl.find('image')[0]);
      var x = parseInt(imgEl.attr('x'));
      var y = parseInt(imgEl.attr('y'));
      $(self._jobCursor).css({
         top: y + 50, // margin top
         left: x + 0, // margin left
      });

      if (!self._jobData[jobAlias]) {
         return;
      }

      var job = self._jobData[jobAlias].description;
      var defTalisman = job.talisman_uri && App.catalog.getCatalogData(job.talisman_uri);
      if (defTalisman) {
         var talisman_uris = job.talisman_uris || {[job.talisman_uri] : true};
         if (talisman_uris) {
            var talismans = [];
            radiant.each(talisman_uris, (uri, enabled) => {
               if (enabled && uri != job.talisman_uri) {
                  talismans.push(App.catalog.getCatalogData(uri));
               }
            });

            if (talismans.length > 0) {
               // if there are alternate talismans that could be used, indicate that in a tooltip
               App.tooltipHelper.createDynamicTooltip(self.$('#requiredTalisman'), function () {
                  var t = '<div class="tooltipJobTalisman">';
                  talismans.forEach(talisman => {
                     if (talisman != defTalisman) {
                        t += `<div class="tooltipJobTalismanEntry"><img src="${talisman.icon}"><div>${i18n.t(talisman.display_name)}</div></div>`;
                     }
                  })
                  t += '</div>';
                  return $(App.tooltipHelper.createTooltip(i18n.t('stonehearth_ace:ui.game.promotion_tree.alternate_talismans'), t));
               });
            }
            else {
               App.tooltipHelper.removeDynamicTooltip(self.$('#requiredTalisman'));
            }
         }
      }
      
      var parents = self.getParentJobs(job);
      var parentJobs = [];
      var oneOfJobs = [];
      parents.forEach(parentJob => {
         var job = parentJob.job;
         job = job != self._baseWorkerJob ? (self._jobData[job] ? self._jobData[job].description : null) : null;
         if (job) {
            var parentRequiredLevel = parentJob.level_requirement ? parentJob.level_requirement : 0;
            var requirementMet = true;
            if (!self._citizenAllowedJobs || self._citizenAllowedJobs[parentJob.job]) {
               var parentJobController = self._citizenJobData[parentJob.job];
               if (parentJobController != undefined) {
                  if (parentJobController.last_gained_lv < parentRequiredLevel) {
                     requirementMet = false;
                  }
               }
               else {
                  requirementMet = false;
               }
            }
            if (parentJob.one_of) {
               oneOfJobs.push({"display_name": job.display_name, "level_requirement": parentRequiredLevel, "requirement_met": requirementMet});
            }
            else {
               parentJobs.push({"display_name": job.display_name, "level_requirement": parentRequiredLevel, "requirement_met": requirementMet});
            }
         }
      });

      // Need to also check if the class requires another class as a pre-req
      // For example: if the parent job is NOT worker, we need to be level 3 at that job in order to allow upgrade
      var requirementsMet = self._jobData[jobAlias].available || jobAlias == self._startingJob;
      var promoteOk = !self.get('jobLocked') && jobAlias != self._startingJob && requirementsMet;

      if (jobAlias != self._startingJob) {
         self.$('#innerCur').hide();
         self.$('#innerNew').show();
      } else {
         self.$('#innerCur').show();
         self.$('#innerNew').hide();
      }

      if (requirementsMet) {
         self.$('#deniedStamp').hide();
      } else {
         self.$('#deniedStamp').show();
      }

      if (promoteOk) {
         self.$('#promoteTitle').removeClass('disabledTitle').addClass('enabledTitle');
         self.$('#approveStamper').fadeIn();
         self.$('#approveStamp').show();
      } else {
         self.$('#promoteTitle').removeClass('enabledTitle').addClass('disabledTitle');
         self.$('#approveStamper').fadeOut();
         self.$('#approveStamp').hide();
      }

      // Tell Handlebars about changes.
      self.set('selectedJobAlias', jobAlias);
      self.set('selectedJob', job);
      self.set('selectedJobTalisman', defTalisman);
      //self.set('parentJob', parentJob);
      //self.set('parentRequiredLevel', parentRequiredLevel);
      self.set('parentJobs', parentJobs);
      self.set('oneOfJobs', oneOfJobs);
      self.set('requiredTalismanAvailable', self._jobData[jobAlias].talismanAvailable !== false);
      self.set('requirementsMet', requirementsMet);
      self.set('promoteOk', promoteOk);

      // Update job Info section: icons and such.
      // get the kingdom-specific job alias
      var kingdomJob = self._jobData[jobAlias].description.__self || jobAlias;
      self._updateJobPerks(kingdomJob);
		
      //console.log('finished updating UI');
   },

   // Call only with jobs whose talismans exist in the world
   // True if the current job is worker or has a parent that is the worker class
   // If there is a parent job and a required level of the parent job,
   // take that into consideration also
   // ACE: handle multiple job parents and non-worker base job
   _calculateRequirementsMet: function(jobAlias) {
      var self = this;

      var jobDescription = self._jobData[jobAlias].description;
      var selectedJobAlias = self.get('selectedJobAlias');
      if (!self._jobData[selectedJobAlias]) {
         return false;
      }
      var selectedJob = self._jobData[selectedJobAlias].description;

      if (jobAlias == self._baseWorkerJob || jobDescription.parent_job == self._baseWorkerJob) {
         return true;
      }

      var parents = self.getParentJobs(jobDescription);
      var parent_jobs = [];
      parents.forEach(parent_job => {
         if (!self._citizenAllowedJobs || self._citizenAllowedJobs[parent_job.job]) {  // If we can't have the parent job, ignore that requirement.
            parent_jobs.push(parent_job);
         }
      });

      var one_of = undefined;
      var result = undefined;
      parent_jobs.forEach(parent_job => {
         if (parent_job.job != self._baseWorkerJob)
         {
            var parentJobController = self._citizenJobData[parent_job.job];
            var parentRequiredLevel = parent_job.level_requirement ? parent_job.level_requirement : 0;

            if (parent_job.one_of)
            {
               if (!one_of) {
                  one_of = false;
               }
               if (parentJobController != undefined) {
                  $.each(self._citizenJobData, function(alias, jobData) {
                     if (alias == parent_job.job && jobData.last_gained_lv >= parentRequiredLevel) {
                        one_of = true;
                     }
                  })
               }
            }
            else {
               if (parentJobController != undefined) {
                  $.each(self._citizenJobData, function(alias, jobData) {
                     if (alias == parent_job.job && jobData.last_gained_lv < parentRequiredLevel) {
                        result = false;
                        return;
                     }
                  })
               }
               else {
                  result = false;
               }
            }
            if (result != undefined) {
               return;
            }
         }
      });
      
      return result != false && one_of != false;
   },

   // Go through the selected job and annotate the perk table accordingly
   // ACE: handle non-worker base job
   _updateJobPerks : function(jobAlias) {
      var self = this;

      // Hide all the divs before selectively showing the ones for the current job.
      self.$('.jobData').hide();

      radiant.each(self._jobData, function(alias, jobData) {
         if (alias != self._baseWorkerJob && jobData.description.__self == jobAlias) {
            var citizenJob = self._citizenJobData[alias];
            var highestLvl = citizenJob ? citizenJob.last_gained_lv : -1;
            var div = self.$("[uri='" + jobAlias + "']");
            self._unlockPerksToLevel(div, highestLvl)
            $(div).show();
         }
      });

      // Make the job tooltips.
      this._updateJobTooltips();
   },

   // Given a perk div and target level, change the classes within to reflect the current level
   _unlockPerksToLevel : function(target_div, target_level) {
      $(target_div).find('.levelLabel').addClass('lvLabelLocked');
      $(target_div).find('img').addClass('perkImgLocked');
      for (var i = 0; i <= target_level; i++) {
         $(target_div).find("[imgLevel='" + i + "']").removeClass('perkImgLocked').addClass('perkImgUnlocked');
         $(target_div).find("[lbLevel='" + i + "']").removeClass('lvLabelLocked').addClass('lvLabelUnlocked');
         $(target_div).find("[divLevel='" + i + "']").attr('locked', "false");
      }
   },

   // Make tooltips for the perks
   _updateJobTooltips : function() {
      var self = this;
      $('.tooltip').tooltipster();
      $('.perkDiv').each(function(index) {
         var perkName = $(this).attr('name');
         var perkDescription = $(this).attr('description');
         var tooltipString = '<div class="perkTooltip"> <h2>' + i18n.t(perkName);

         // If we're locked then add the locked label.
         if ($(this).attr('locked') == "true") {
            tooltipString = tooltipString + '<span class="lockedTooltipLabel">' + i18n.t('stonehearth:ui.game.citizen_character_sheet.locked_status') + '</span>';
         }

         tooltipString = tooltipString + '</h2>'+ i18n.t(perkDescription) + '</div>';
         $(this).tooltipster('content', $(tooltipString));
      });
   },

   _promote: function(jobAlias) {
      var self = this;
      if (!self.get('promoteOk')) {
         return false;
      }

      var jobInfo = self._jobData[jobAlias];

      var citizen = this.get('citizen');
      if (!citizen) return;
      var talisman = jobInfo.description.talisman_uri;

      radiant.call('stonehearth:grab_promotion_talisman', citizen.__self, jobAlias);

      return true;
   },

   _animateStamper: function() {
      var self = this;

      radiant.call('radiant:play_sound', {
         'track': 'stonehearth:sounds:ui:promotion_menu:stamp'
      });

      // animate down
      self.$('#approveStamper').animate({
         bottom: 20
      }, 130, function() {
         var approveStamper = self.$('#approvedStamp');
         if (!approveStamper) {
            // If approve stamper doesn't exist here, we might already have been destroyed.
            return;
         }
         self.$('#approvedStamp').show();
         //animate up
         $(this)
            .delay(200)
            .animate({
               bottom: 200
            }, 150, function() {
               // close the wizard after a short delay
               setTimeout(function() {
                  self.invokeDestroy();
               }, 600);
            });
      });
   },

   dateString: function() {
      var dateObject = App.gameView.getDateTime();
      var od = this.ordinalSuffixOf(dateObject.day)
      var dateLocalized = i18n.t('stonehearth:ui.game.calendar.date_format_long_ordinal',
         {ord_day: od, date: dateObject});

      return dateLocalized;
   },

   destroy: function() {
      radiant.call('radiant:play_sound', {
         'track': 'stonehearth:sounds:ui:start_menu:page_down'
      });

      if (this._jobsTrace) {
         this._jobsTrace.destroy();
      }

      if (this._citizenTrace) {
         this._citizenTrace.destroy();
      }

      if (this._playerInventoryTrace) {
         this._playerInventoryTrace.destroy();
      }

      App.stonehearth.promotionTreeView = null;

      this._super();
   },

});

function ordinalSuffixOf(d) {
    var d1 = d % 10,
        d2 = d % 100;
    if (d1 == 1 && d2 != 11) {
        return d + "st";
    }
    if (d1 == 2 && d2 != 12) {
        return d + "nd";
    }
    if (d1 == 3 && d2 != 13) {
        return d + "rd";
    }
    return d + "th";
}
