'use strict';

/**
 * searchPath uses PathFinder and the room costMatrix to search for a path
 *
 *
 * @param {object} target - The target to move to
 * @param {number} range - How close to get to the target
 * @return {object} - Response from PathFinder.search
 **/
Creep.prototype.searchPath = function(target, range=1) {
  let costMatrixCallback;
  if (this.room.memory.misplacedSpawn) {
    costMatrixCallback = this.room.getBasicCostMatrixCallback();
  } else {
    costMatrixCallback = this.room.getCostMatrixCallback(target, true, this.pos.roomName === (target.pos || target).roomName);
  }
  const search = PathFinder.search(
    this.pos, {
      pos: target,
      range: range,
    }, {
      roomCallback: costMatrixCallback,
      maxRooms: 0,
      swampCost: config.layout.swampCost,
      plainCost: config.layout.plainCost,
    },
  );

  if (config.visualizer.enabled && config.visualizer.showPathSearches) {
    visualizer.showSearch(search);
  }
  return search;
};

Creep.prototype.moveMy = function(target) {
  const direction = this.pos.getDirectionTo(target);
  const moveResponse = this.move(direction);
  if (moveResponse !== OK && moveResponse !== ERR_NO_BODYPART) {
    this.log(`pos: ${this.pos} target ${target}`);
    throw new Error(`moveToMy(${target}) this.move(${this.pos.getDirectionTo(target)}); => ${moveResponse}`);
  }
  this.creepLog(`moveMy direction ${direction} moveResponse ${moveResponse}`);
  return moveResponse === OK;
};

/**
 * moveToMy replaces the moveTo method and tries to include the costmatrixes
 *
 * @param {object} target - The target to move to
 * @param {number} range - How close to get to the target
 * @return {boolean} - Success of the execution
 **/
Creep.prototype.moveToMy = function(target, range=1) {
  this.creepLog(`moveToMy(${target}, ${range}) pos: ${this.pos}`);
  if (this.fatigue > 0) {
    return true;
  }

  const search = this.searchPath(target, range);

  // Fallback to moveTo when the path is incomplete and the creep is only switching positions
  if (search.path.length < 2 && search.incomplete) {
    this.creepLog(`moveToMy(${target}, ${range}) pos: ${this.pos} search incomplete search: ${JSON.stringify(search)}`);
    this.room.debugLog('routing', `moveToMy fallback target: ${JSON.stringify(target)} range: ${range} search: ${JSON.stringify(search)}`);
    return this.moveTo(target, {range: range});
  }
  this.creepLog(`moveToMy(${target}, ${range}) pos: ${this.pos} search: ${JSON.stringify(search)}`);
  target = search.path[0] || target.pos || target;

  const moveMyResult = this.moveMy(target, search);
  this.creepLog(`moveMyResult ${moveMyResult}`);
  return moveMyResult;
};

Creep.prototype.moveRandom = function(onPath) {
  const startDirection = _.random(1, 8);
  let direction = 0;
  for (let i = 0; i < 8; i++) {
    direction = RoomPosition.changeDirection(startDirection, i);
    const pos = this.pos.getAdjacentPosition(direction);
    if (pos.isBorder(-1)) {
      continue;
    }
    if (onPath && !pos.inPath()) {
      continue;
    }
    if (pos.checkForWall()) {
      continue;
    }
    if (pos.checkForObstacleStructure()) {
      continue;
    }
    break;
  }
  this.move(direction);
};

Creep.prototype.moveRandomWithin = function(goal, dist = 3, goal2 = false) {
  const startDirection = _.random(1, 8);
  let direction = 0;
  for (let i = 0; i < 8; i++) {
    direction = RoomPosition.changeDirection(startDirection, i);
    let pos;
    try {
      pos = this.pos.getAdjacentPosition(direction);
    } catch (e) {
      continue;
    }
    if (pos.isBorder(-1)) {
      continue;
    }
    if (pos.getRangeTo(goal) > dist) {
      continue;
    }
    if (goal2 && pos.getRangeTo(goal2) > dist) {
      continue;
    }
    if (pos.checkForWall()) {
      continue;
    }
    if (pos.checkForObstacleStructure()) {
      continue;
    }
    break;
  }
  this.move(direction);
};

Creep.prototype.moveCreep = function(position, direction) {
  if (position.isBorder(-1)) {
    return false;
  }

  const pos = new RoomPosition(position.x, position.y, this.room.name);
  const creeps = pos.lookFor('creep');
  if (creeps.length > 0 && creeps[0].memory) {
    const role = this.memory.role;
    if (creeps[0] && !creeps[0].memory.routing) {
      creeps[0].memory.routing = {};
    }
    if ((role === 'sourcer' || role === 'reserver') && creeps[0].memory.role !== 'harvester' && !creeps[0].memory.routing.reverse) {
      creeps[0].move(direction);
      return true;
    }
    const targetRole = creeps[0].memory.role;
    if (role === 'defendmelee' ||
      targetRole === 'harvester' ||
      targetRole === 'carry') {
      creeps[0].move(direction);
      return true;
    }
    if (role === 'upgrader' &&
      targetRole === 'storagefiller') {
      creeps[0].move(direction);
      return true;
    }
    if (role === 'upgrader' &&
      (targetRole === 'harvester' || targetRole === 'sourcer' || targetRole === 'upgrader')) {
      this.log('config_creep_move suicide ' + targetRole);
      creeps[0].suicide();
      return true;
    }
  }
};

Creep.prototype.preMoveExtractorSourcer = function(directions) {
  this.pickupEnergy();

  if (!this.room.controller) {
    const target = this.findClosestSourceKeeper();
    if (target !== null) {
      const range = this.pos.getRangeTo(target);
      if (range > 6) {
        this.memory.routing.reverse = false;
      }
      if (range < 6) {
        this.memory.routing.reverse = true;
      }
    } else {
      this.memory.routing.reverse = false;
    }
  }

  // TODO copied from nextroomer, should be extracted to a method or a creep flag
  // Remove structures in front
  if (!directions) {
    return false;
  }
  // TODO when is the forwardDirection missing?
  if (directions.forwardDirection) {
    const posForward = this.pos.getAdjacentPosition(directions.forwardDirection);
    const structures = posForward.lookFor(LOOK_STRUCTURES);
    for (const structure of structures) {
      if (structure.structureType === STRUCTURE_ROAD) {
        continue;
      }
      if (structure.structureType === STRUCTURE_RAMPART && structure.my) {
        continue;
      }
      if (structure.structureType === STRUCTURE_SPAWN && structure.my) {
        continue;
      }
      this.dismantle(structure);
      this.say('dismantle', true);
      break;
    }
  }
};

Creep.prototype.checkForSourceKeeper = function() {
  if (!this.room.controller) {
    const target = this.findClosestSourceKeeper();
    if (target !== null) {
      const range = this.pos.getRangeTo(target);
      if (range > 6) {
        this.memory.routing.reverse = false;
        return false;
      }
      if (range < 6) {
        this.memory.routing.reverse = true;
        return true;
      }
    }
  }
  return false;
};
