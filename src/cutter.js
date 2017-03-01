import {
  ASSERT,
  ASSERT_LOG2,
  THROW,
} from './helpers';

import {
  ML_START,
  ML_VV_EQ,
  ML_V8_EQ,
  ML_88_EQ,
  ML_VV_NEQ,
  ML_V8_NEQ,
  ML_88_NEQ,
  ML_VV_LT,
  ML_V8_LT,
  ML_8V_LT,
  ML_88_LT,
  ML_VV_LTE,
  ML_V8_LTE,
  ML_8V_LTE,
  ML_88_LTE,
  ML_VVV_ISEQ,
  ML_V8V_ISEQ,
  ML_VV8_ISEQ,
  ML_88V_ISEQ,
  ML_V88_ISEQ,
  ML_888_ISEQ,
  ML_VVV_ISNEQ,
  ML_V8V_ISNEQ,
  ML_VV8_ISNEQ,
  ML_88V_ISNEQ,
  ML_V88_ISNEQ,
  ML_888_ISNEQ,
  ML_VVV_ISLT,
  ML_8VV_ISLT,
  ML_V8V_ISLT,
  ML_VV8_ISLT,
  ML_88V_ISLT,
  ML_V88_ISLT,
  ML_8V8_ISLT,
  ML_888_ISLT,
  ML_VVV_ISLTE,
  ML_8VV_ISLTE,
  ML_V8V_ISLTE,
  ML_VV8_ISLTE,
  ML_88V_ISLTE,
  ML_V88_ISLTE,
  ML_8V8_ISLTE,
  ML_888_ISLTE,
  ML_NALL,
  ML_ISALL,
  ML_ISALL2,
  ML_ISNALL,
  ML_ISNONE,
  ML_8V_SUM,
  ML_PRODUCT,
  ML_DISTINCT,
  ML_PLUS,
  ML_MINUS,
  ML_MUL,
  ML_DIV,
  ML_VV_AND,
  ML_VV_OR,
  ML_VV_XOR,
  ML_VV_NAND,
  ML_VV_XNOR,
  ML_DEBUG,
  ML_JMP,
  ML_JMP32,
  ML_NOOP,
  ML_NOOP2,
  ML_NOOP3,
  ML_NOOP4,
  ML_STOP,

  SIZEOF_V,
  SIZEOF_W,
  SIZEOF_VV,
  SIZEOF_VVV,
  SIZEOF_8VV,
  SIZEOF_V8V,
  SIZEOF_COUNT,
  SIZEOF_C8,

  ml__debug,
  ml_dec8,
  ml_dec16,
  ml_dec32,
  ml_enc8,
  ml_enc16,
  ml_eliminate,
  ml_getOpSizeSlow,
  ml_getRecycleOffset,
  ml_heapSort16bitInline,
  ml_jump,
  ml_recycleVV,
  ml_skip,
  ml_throw,
  ml_validateSkeleton,

  ml_c2vv,
  ml_cr2vv,
  ml_vv2vv,
  ml_vvv2vv,
  ml_vvv2vvv,
} from './ml';
import {
  domain__debug,
  domain_containsValue,
  domain_createValue,
  domain_createRange,
  domain_hasNoZero,
  domain_intersection,
  domain_isBool,
  domain_isZero,
  domain_min,
  domain_max,
  domain_getValue,
  domain_removeValue,
  domain_removeGte,
  domain_removeLte,
  domain_removeGtUnsafe,
  domain_removeLtUnsafe,
} from './domain';
import domain_plus from './domain_plus';

import {
  BOUNTY_MAX_OFFSETS_TO_TRACK,
  BOUNTY_ISALL_RESULT,
  BOUNTY_LTE_LHS,
  BOUNTY_LTE_RHS,
  BOUNTY_NALL,
  BOUNTY_NAND,
  BOUNTY_NEQ,
  BOUNTY_NOT_BOOLY,
  BOUNTY_OR,

  bounty_collect,
  bounty_getCounts,
  bounty_getMeta,
  bounty_getOffset,
  bounty_markVar,
} from './bounty';


// BODY_START

const CUTTER_NEQ_TRICK_FLAGS = BOUNTY_LTE_LHS | BOUNTY_LTE_RHS | BOUNTY_OR | BOUNTY_NAND;

function cutter(ml, vars, domains, addAlias, getAlias, solveStack, once) {
  ASSERT_LOG2('\n ## cutter', ml);
  let pc = 0;

  let bounty;

  let lenBefore;
  let emptyDomain = false;
  let changes = 0;
  let loops = 0;
  do {
    ASSERT_LOG2(' # start cutter outer loop', loops);
    bounty = bounty_collect(ml, vars, domains, getAlias, bounty);
    lenBefore = solveStack.length;
    changes = 0;
    cutLoop();
    console.log(' - end cutter outer loop', loops, ', removed:', solveStack.length - lenBefore, ' vars, total changes:', changes, ', emptyDomain =', emptyDomain);
    ++loops;
  } while (!emptyDomain && changes && !once);

  ASSERT_LOG2('## exit cutter');
  if (emptyDomain) return -1;
  return loops;

  function getFinalIndex(index, _max = 50) {
    if (_max <= 0) THROW('damnit');
    ASSERT_LOG2('         getFinalIndex: ' + index + ' -> ' + domain__debug(domains[index]));
    if (domains[index] !== false) return index;

    // if the domain is falsy then there was an alias 6sx(or a bug)
    // write the alias back to ML and restart the current op
    // caller should ensure to check return value and return on
    // a falsy result as well so the loop can restart.
    let aliasIndex = getAlias(index);
    ASSERT(aliasIndex !== index, 'an alias to itself is an infi loop and a bug');
    ASSERT_LOG2(' - alias for', index, 'is', aliasIndex);
    return getFinalIndex(aliasIndex, _max - 1);
  }

  function somethingChanged() {
    ++changes;
  }

  function cutNeq() {
    let indexA = getFinalIndex(ml_dec16(ml, pc + 1));
    let indexB = getFinalIndex(ml_dec16(ml, pc + 3));

    let countsA = bounty_getCounts(bounty, indexA);
    let countsB = bounty_getCounts(bounty, indexB);

    ASSERT_LOG2(' - cutNeq', indexA, '!=', indexB, 'counts:', countsA, countsB, ', meta:', bounty_getMeta(bounty, indexA), bounty_getMeta(bounty, indexB));

    if (countsA === 1) {
      return leafNeq(ml, indexA, indexB);
    }

    if (countsB === 1) {
      return leafNeq(ml, indexB, indexA);
    }

    if (countsA >= 2 && countsA <= BOUNTY_MAX_OFFSETS_TO_TRACK) {
      let metaA = bounty_getMeta(bounty, indexA);
      if ((metaA & BOUNTY_NEQ) && (metaA & CUTTER_NEQ_TRICK_FLAGS)) {
        // so A has neq and at least one of the two lte flags. remove all those flags to confirm there wasnt anything else
        metaA = (metaA | BOUNTY_NEQ | CUTTER_NEQ_TRICK_FLAGS) ^ (BOUNTY_NEQ | CUTTER_NEQ_TRICK_FLAGS); // remove neq and lte flags
        if (!metaA && trickNeqElimination(indexA)) return;
      }
    }

    if (countsB >= 2 && countsB <= BOUNTY_MAX_OFFSETS_TO_TRACK) {
      let metaB = bounty_getMeta(bounty, indexB);
      if ((metaB & BOUNTY_NEQ) && (metaB & CUTTER_NEQ_TRICK_FLAGS)) {
        // so A has neq and at least one of the two lte flags. remove all those flags to confirm there wasnt anything else
        metaB = (metaB | BOUNTY_NEQ | CUTTER_NEQ_TRICK_FLAGS) ^ (BOUNTY_NEQ | CUTTER_NEQ_TRICK_FLAGS); // remove neq and lte flags
        if (!metaB && trickNeqElimination(indexB)) return;
      }
    }

    pc += SIZEOF_VV;
  }

  function cutLt() {
    let indexA = getFinalIndex(ml_dec16(ml, pc + 1));
    let indexB = getFinalIndex(ml_dec16(ml, pc + 3));

    let countsA = bounty_getCounts(bounty, indexA);
    let countsB = bounty_getCounts(bounty, indexB);

    ASSERT_LOG2(' - cutLt', indexA, '<', indexB, 'counts:', countsA, countsB, ', meta:', bounty_getMeta(bounty, indexA), bounty_getMeta(bounty, indexB));

    if (countsA === 1) {
      ASSERT_LOG2('   - A is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut lt A;', indexA, '<', indexB, '  ->  ', domain__debug(domains[indexA]), '<', domain__debug(domains[indexB]));
        let A = domains[indexA];
        let vB = force(indexB);
        ASSERT_LOG2('   - Setting', indexA, '(', domain__debug(A), ') to be lt', indexB, '(', vB, ')');
        domains[indexA] = domain_removeGte(A, vB);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexA));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = vars[indexA] + ' < ' + vars[indexB]));
      ml_eliminate(ml, pc, SIZEOF_VV);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      somethingChanged();
      return;
    }

    if (countsB === 1) {
      ASSERT_LOG2('   - B is a leaf var');
      solveStack.push((domains, force) => {
        let vA = force(indexA);
        let B = domains[indexB];
        ASSERT_LOG2(' - cut lt B; Setting', indexA, '(', vA, ') to be lt', indexB, '(', domain__debug(B), ')');
        domains[indexB] = domain_removeLte(B, vA);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexB));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexA + ' < ' + indexB));
      ml_eliminate(ml, pc, SIZEOF_VV);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      somethingChanged();
      return;
    }

    pc += SIZEOF_VV;
  }

  function cutLte() {
    let indexA = getFinalIndex(ml_dec16(ml, pc + 1));
    let indexB = getFinalIndex(ml_dec16(ml, pc + 3));

    let countsA = bounty_getCounts(bounty, indexA);
    let countsB = bounty_getCounts(bounty, indexB);

    ASSERT_LOG2(' - cutLte', indexA, '<=', indexB, 'counts:', countsA, countsB, ', meta:', bounty_getMeta(bounty, indexA), bounty_getMeta(bounty, indexB));

    if (countsA === 1) {
      return leafLteLhs(ml, indexA, indexB);
    }

    if (countsB === 1) {
      return leafLteRhs(ml, indexA, indexB);
    }

    if (countsA === 2) {
      let metaA = bounty_getMeta(bounty, indexA);
      if ((metaA & BOUNTY_NAND) && trickNandLteLhs(indexA, pc, 'lte')) return;
      // note: if it wasnt 2x lte then the flag would contain, at least, another flag as well.
      if (metaA === (BOUNTY_LTE_LHS | BOUNTY_NOT_BOOLY) && trickLteLhsTwice(indexA, pc, 'lte', metaA)) return;
    }

    if (countsB === 2) {
      let metaB = bounty_getMeta(bounty, indexB);
      if ((metaB & BOUNTY_ISALL_RESULT) && trickIsallLteRhs(indexB, pc, 'lte')) return;
    }

    if (countsA >= 2) {
      let metaA = bounty_getMeta(bounty, indexA);
      if ((metaA & BOUNTY_ISALL_RESULT) && trickLteLhsIsallShared(indexA, pc)) return;
    }

    if (countsA >= 3) {
      let metaA = bounty_getMeta(bounty, indexA);
      if (metaA === (BOUNTY_OR | BOUNTY_NAND | BOUNTY_LTE_LHS) && trickOrLteLhsNands(indexA, pc)) return;
      if (metaA === (BOUNTY_OR | BOUNTY_NAND | BOUNTY_LTE_LHS | BOUNTY_LTE_RHS) && trickOrNandLteBoth(indexA, pc)) return;
    }

    pc += SIZEOF_VV;
  }

  function cutIsEq(ml, offset, sizeof, lenB) {
    ASSERT(1 + 2 + lenB + 2 === sizeof, 'expecting this sizeof');
    let indexA;
    let indexB;
    let indexR = getFinalIndex(ml_dec16(ml, offset + 1 + 2 + lenB));
    let countsR = bounty_getCounts(bounty, indexR);

    ASSERT(!void (indexA = getFinalIndex(ml_dec16(ml, offset + 1))));
    ASSERT(!void (indexB = lenB === 1 ? ml_dec8(ml, offset + 1 + 2) : getFinalIndex(ml_dec16(ml, offset + 1 + 2))));
    ASSERT_LOG2(' - cutIsEq', indexR, '=', indexA, '==?', indexB, 'counts:', countsR, bounty_getCounts(bounty, indexA), lenB === 2 && bounty_getCounts(bounty, indexB), ', meta:', bounty_getMeta(bounty, indexR), bounty_getMeta(bounty, indexA), lenB === 2 && bounty_getMeta(bounty, indexB));

    if (countsR === 1) {
      indexA = getFinalIndex(ml_dec16(ml, offset + 1));
      indexB = lenB === 1 ? ml_dec8(ml, offset + 1 + 2) : getFinalIndex(ml_dec16(ml, offset + 1 + 2));
      ASSERT_LOG2('   - R is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut iseq R;', indexR, '=', indexA, '==?', indexB, '  ->  ', domain__debug(domains[indexR]), '=', domain__debug(domains[indexA]), '==?', domain__debug(domains[indexB]));
        let vA = force(indexA);
        let vB = lenB === 1 ? indexB : force(indexB);
        let matches = vA === vB ? 1 : 0;
        ASSERT(domain_min(domains[indexR]) === 0 && domain_max(domains[indexR]) > 0, 'A B and R should already have been reduced to domains that are valid within A==?B=R', vA, vB, matches, domain__debug(domains[indexR]));
        domains[indexR] = matches ? domain_removeValue(domains[indexR], 0) : domain_createValue(0);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexR));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = `${indexR} = ${indexA} ==? ${indexB}`));
      ml_eliminate(ml, pc, sizeof);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      bounty_markVar(bounty, indexR);
      somethingChanged();
      return;
    }

    // note: A can not be a constant because we normalize iseq args that way
    if (lenB === 1) {
      indexA = getFinalIndex(ml_dec16(ml, offset + 1));
      let countsA = bounty_getCounts(bounty, indexA);
      if (countsA === 1) {
        // A is leaf, B is constant, cut the constraint, A can reflect B and C afterwards
        // we assume that A contains a valid value for B and both cases C=0 and C=1
        let A = domains[indexA];
        let vB = ml_dec8(ml, offset + 1 + 2);

        ASSERT_LOG2('   - A is a leaf var, B a constant (', vB, ')');
        solveStack.push((domains, force) => {
          ASSERT_LOG2(' - cut iseq A;', indexR, '=', indexA, '==? c  ->  ', domain__debug(domains[indexR]), '=', domain__debug(A), '==?', vB);
          let vR = force(indexR);
          ASSERT(domain_removeValue(A, vB), 'A should be able to reflect R=0 with B');
          ASSERT(domain_containsValue(A, vB), 'A should be able to reflect R=1 with B');
          domains[indexA] = vR ? domain_createValue(vB) : domain_removeValue(A, vB);
        });
        ASSERT(!void (solveStack[solveStack.length - 1]._target = indexA));
        ASSERT(!void (solveStack[solveStack.length - 1]._meta = `${vars[indexR]} = ${vars[indexA]} ==? L${vB}`));
        ml_eliminate(ml, offset, sizeof);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexR);
        somethingChanged();
        return;
      }
    }

    pc = offset + sizeof;
  }

  function cutIsNeq(ml, offset, sizeof, lenB) {
    ASSERT(1 + 2 + lenB + 2 === sizeof, 'expecting this sizeof');
    let indexA;
    let indexB;
    let indexR = getFinalIndex(ml_dec16(ml, offset + 1 + 2 + lenB));
    let countsR = bounty_getCounts(bounty, indexR);

    ASSERT(!void (indexA = getFinalIndex(ml_dec16(ml, offset + 1))));
    ASSERT(!void (indexB = lenB === 1 ? ml_dec8(ml, offset + 1 + 2) : getFinalIndex(ml_dec16(ml, offset + 1 + 2))));
    ASSERT_LOG2(' - cutIsNeq', indexR, '=', indexA, '!=?', indexB, 'counts:', countsR, bounty_getCounts(bounty, indexA), lenB === 2 && bounty_getCounts(bounty, indexB), ', meta:', bounty_getMeta(bounty, indexR), bounty_getMeta(bounty, indexA), lenB === 2 && bounty_getMeta(bounty, indexB));

    if (countsR === 1) {
      indexA = getFinalIndex(ml_dec16(ml, offset + 1));
      indexB = lenB === 1 ? ml_dec8(ml, offset + 1 + 2) : getFinalIndex(ml_dec16(ml, offset + 1 + 2));

      ASSERT_LOG2('   - R is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut isneq R;', indexR, '=', indexA, '!=?', indexB, '  ->  ', domain__debug(domains[indexR]), '=', domain__debug(domains[indexA]), '!=?', domain__debug(domains[indexB]));
        let vA = force(indexA);
        let vB = lenB === 1 ? indexB : force(indexB);
        let vR = vA !== vB ? 1 : 0;
        ASSERT(domain_containsValue(domains[indexR], vR), 'A B and R should already have been reduced to domains that are valid within A!=?B=R', vA, vB, vR, domain__debug(domains[indexR]));
        domains[indexR] = domain_createValue(vR);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexR));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = `${indexR} = ${indexA} !=? ${indexB}`));

      ml_eliminate(ml, pc, sizeof);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      bounty_markVar(bounty, indexR);
      somethingChanged();
      return;
    }

    if (lenB === 1) {
      indexA = getFinalIndex(ml_dec16(ml, offset + 1));
      let countsA = bounty_getCounts(bounty, indexA);
      if (countsA === 1) {
        // A is leaf, B is constant, cut the constraint, A can reflect B and C afterwards
        // we assume that A contains a valid value for B and both cases C=0 and C=1
        let A = domains[indexA];
        let vB = ml_dec8(ml, offset + 1 + 2);

        ASSERT_LOG2('   - A is a leaf var, B a constant (', vB, ')');
        solveStack.push((domains, force) => {
          ASSERT_LOG2(' - cut isneq A;', indexR, '=', indexA, '!=? c  ->  ', domain__debug(domains[indexR]), '=', domain__debug(A), '!=?', vB);
          let vR = force(indexR);
          ASSERT(domain_removeValue(A, vB), 'A should be able to reflect R=0 with B');
          ASSERT(domain_containsValue(A, vB), 'A should be able to reflect R=1 with B');
          domains[indexA] = vR ? domain_removeValue(A, vB) : domain_createValue(vB);
        });
        ASSERT(!void (solveStack[solveStack.length - 1]._target = indexA));
        ASSERT(!void (solveStack[solveStack.length - 1]._meta = `${vars[indexR]} = ${vars[indexA]} !=? L${vB}`));
        ml_eliminate(ml, offset, sizeof);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexR);
        somethingChanged();
        return;
      }
    }

    pc = offset + sizeof;
  }

  function cutIsLt(ml, offset, sizeof, lenA, lenB) {
    ASSERT(1 + 2 + lenB + 2 === sizeof, 'expecting this sizeof');
    let indexA;
    let indexB;
    let indexR = getFinalIndex(ml_dec16(ml, offset + 1 + lenA + lenB));
    let countsR = bounty_getCounts(bounty, indexR);

    ASSERT(!void (indexA = lenA === 1 ? ml_dec8(ml, offset + 1) : getFinalIndex(ml_dec16(ml, offset + 1))));
    ASSERT(!void (indexB = lenB === 1 ? ml_dec8(ml, offset + 1 + lenA) : getFinalIndex(ml_dec16(ml, offset + 1 + lenA))));
    ASSERT_LOG2(' - cutIsLt', indexR, '=', indexA, '<?', indexB, 'counts:', countsR, bounty_getCounts(bounty, indexA), lenB === 2 && bounty_getCounts(bounty, indexB), ', meta:', bounty_getMeta(bounty, indexR), bounty_getMeta(bounty, indexA), lenB === 2 && bounty_getMeta(bounty, indexB));

    if (countsR === 1) {
      indexA = lenA === 1 ? ml_dec8(ml, offset + 1) : getFinalIndex(ml_dec16(ml, offset + 1));
      indexB = lenB === 1 ? ml_dec8(ml, offset + 1 + lenA) : getFinalIndex(ml_dec16(ml, offset + 1 + lenA));

      ASSERT_LOG2('   - R is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut islt R;', indexR, '=', indexA, '<?', indexB, '  ->  ', domain__debug(domains[indexR]), '=', domain__debug(domains[indexA]), '<?', domain__debug(domains[indexB]));
        let vA = lenA === 1 ? indexA : force(indexA);
        let vB = lenB === 1 ? indexB : force(indexB);
        let vR = vA < vB ? 1 : 0;
        ASSERT(domain_containsValue(domains[indexR], vR), 'A B and R should already have been reduced to domains that are valid within A<?B=R;', vA, '<?', vB, '=', vR, domain__debug(domains[indexR]));
        domains[indexR] = domain_createValue(vR);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexR));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = `${indexR} = ${indexA} <? ${indexB}`));

      ml_eliminate(ml, pc, sizeof);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      bounty_markVar(bounty, indexR);
      somethingChanged();
      return;
    }

    if (lenB === 1) {
      indexA = lenA === 1 ? ml_dec8(ml, offset + 1) : getFinalIndex(ml_dec16(ml, offset + 1));
      let countsA = bounty_getCounts(bounty, indexA);
      if (countsA === 1) {
        // A is leaf, B is constant, cut the constraint, A can reflect B and C afterwards
        // we assume that A contains a valid value for B and both cases C=0 and C=1
        let A = domains[indexA];
        let vB = ml_dec8(ml, offset + 1 + lenA);

        ASSERT_LOG2('   - A is a leaf var, B a constant (', vB, ')');
        solveStack.push((domains, force) => {
          ASSERT_LOG2(' - cut islt A;', indexR, '=', indexA, '<? c  ->  ', domain__debug(domains[indexR]), '=', domain__debug(A), '<?', vB);
          let vR = force(indexR);
          ASSERT(domain_removeGte(A, vB), 'A should be able to reflect R=0 with B');
          ASSERT(domain_removeLtUnsafe(A, vB), 'A should be able to reflect R=1 with B');
          domains[indexA] = vR ? domain_removeGte(A, vB) : domain_removeLtUnsafe(A, vB);
        });
        ASSERT(!void (solveStack[solveStack.length - 1]._target = indexA));
        ASSERT(!void (solveStack[solveStack.length - 1]._meta = `${vars[indexR]} = ${vars[indexA]} <? L${vB}`));

        ml_eliminate(ml, offset, sizeof);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexR);
        somethingChanged();
        return;
      }
    }

    if (lenA === 1) {
      indexB = lenB === 1 ? ml_dec8(ml, offset + 1 + lenA) : getFinalIndex(ml_dec16(ml, offset + 1 + lenA));
      let countsB = bounty_getCounts(bounty, indexB);
      if (countsB === 1) {
        // B is leaf, A is constant, cut the constraint, B can reflect A and C afterwards
        // we assume that B contains a valid value for A and both cases C=0 and C=1
        let B = domains[indexB];
        let vA = ml_dec8(ml, offset + 1);

        ASSERT_LOG2('   - A is a leaf var, B a constant (', vA, ')');
        solveStack.push((domains, force) => {
          ASSERT_LOG2(' - cut islt B;', indexR, '= c <?', indexB, ' ->  ', domain__debug(domains[indexR]), '=', vA, '<?', domain__debug(B));
          let vR = force(indexR);
          ASSERT(domain_removeLtUnsafe(B, vA), 'B should be able to reflect R=0 with A');
          ASSERT(domain_removeGte(B, vA), 'B should be able to reflect R=1 with A');
          domains[indexB] = vR ? domain_removeLtUnsafe(B, vA) : domain_removeGte(B, vA);
        });
        ASSERT(!void (solveStack[solveStack.length - 1]._target = indexB));
        ASSERT(!void (solveStack[solveStack.length - 1]._meta = `${vars[indexR]} = L${vA} <? ${vars[indexB]}`));

        ml_eliminate(ml, offset, sizeof);
        bounty_markVar(bounty, indexB);
        bounty_markVar(bounty, indexR);
        somethingChanged();
        return;
      }
    }

    pc = offset + sizeof;
  }

  function cutIsLte(ml, offset, sizeof, lenA, lenB) {
    ASSERT(1 + lenA + lenB + 2 === sizeof, 'expecting this sizeof', 1 + 2 + lenB + 2, sizeof, lenA, lenB);
    let indexA;
    let indexB;
    let indexR = getFinalIndex(ml_dec16(ml, offset + 1 + lenA + lenB));
    let countsR = bounty_getCounts(bounty, indexR);

    ASSERT(!void (indexA = lenA === 1 ? ml_dec8(ml, offset + 1) : getFinalIndex(ml_dec16(ml, offset + 1))));
    ASSERT(!void (indexB = lenB === 1 ? ml_dec8(ml, offset + 1 + lenA) : getFinalIndex(ml_dec16(ml, offset + 1 + lenA))));
    ASSERT_LOG2(' - cutIsLte', indexR, '=', indexA, '<=?', indexB, 'counts:', countsR, bounty_getCounts(bounty, indexA), lenB === 2 && bounty_getCounts(bounty, indexB), ', meta:', bounty_getMeta(bounty, indexR), bounty_getMeta(bounty, indexA), lenB === 2 && bounty_getMeta(bounty, indexB));

    if (countsR === 1) {
      indexA = lenA === 1 ? ml_dec8(ml, offset + 1) : getFinalIndex(ml_dec16(ml, offset + 1));
      indexB = lenB === 1 ? ml_dec8(ml, offset + 1 + lenA) : getFinalIndex(ml_dec16(ml, offset + 1 + lenA));

      ASSERT_LOG2('   - R is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut islte R;', indexR, '=', indexA, '<=?', indexB, '  ->  ', domain__debug(domains[indexR]), '=', domain__debug(domains[indexA]), '<=?', domain__debug(domains[indexB]));
        let vA = lenA === 1 ? indexA : force(indexA);
        let vB = lenB === 1 ? indexB : force(indexB);
        let vR = vA <= vB ? 1 : 0;
        ASSERT(domain_containsValue(domains[indexR], vR), 'A B and R should already have been reduced to domains that are valid within A<=?B=R;', vA, '<?', vB, '=', vR, domain__debug(domains[indexR]));
        domains[indexR] = domain_createValue(vR);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexR));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = `${indexR} = ${indexA} <=? ${indexB}`));

      ml_eliminate(ml, pc, sizeof);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      bounty_markVar(bounty, indexR);
      somethingChanged();
      return;
    }

    if (lenB === 1) {
      indexA = lenA === 1 ? ml_dec8(ml, offset + 1) : getFinalIndex(ml_dec16(ml, offset + 1));
      let countsA = bounty_getCounts(bounty, indexA);
      if (countsA === 1) {
        // A is leaf, B is constant, cut the constraint, A can reflect B and C afterwards
        // we assume that A contains a valid value for B and both cases C=0 and C=1
        let A = domains[indexA];
        let vB = ml_dec8(ml, offset + 1 + lenA);

        ASSERT_LOG2('   - A is a leaf var, B a constant (', vB, ')');
        solveStack.push((domains, force) => {
          ASSERT_LOG2(' - cut islt A;', indexR, '=', indexA, '<=? c  ->  ', domain__debug(domains[indexR]), '=', domain__debug(A), '<=?', vB);
          let vR = force(indexR);
          ASSERT(domain_removeGtUnsafe(A, vB), 'A should be able to reflect R=0 with B');
          ASSERT(domain_removeLte(A, vB), 'A should be able to reflect R=1 with B');
          domains[indexA] = vR ? domain_removeGtUnsafe(A, vB) : domain_removeLte(A, vB);
        });
        ASSERT(!void (solveStack[solveStack.length - 1]._target = indexA));
        ASSERT(!void (solveStack[solveStack.length - 1]._meta = `${vars[indexR]} = ${vars[indexA]} <=? L${vB}`));

        ml_eliminate(ml, offset, sizeof);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexR);
        somethingChanged();
        return;
      }
    }

    if (lenA === 1) {
      indexB = lenB === 1 ? ml_dec8(ml, offset + 1 + lenA) : getFinalIndex(ml_dec16(ml, offset + 1 + lenA));
      let countsB = bounty_getCounts(bounty, indexB);
      if (countsB === 1) {
        // B is leaf, A is constant, cut the constraint, B can reflect A and C afterwards
        // we assume that B contains a valid value for A and both cases C=0 and C=1
        let B = domains[indexB];
        let vA = ml_dec8(ml, offset + 1);

        ASSERT_LOG2('   - A is a leaf var, B a constant (', vA, ')');
        solveStack.push((domains, force) => {
          ASSERT_LOG2(' - cut islt B;', indexR, '= c <=?', indexB, ' ->  ', domain__debug(domains[indexR]), '=', vA, '<=?', domain__debug(B));
          let vR = force(indexR);
          ASSERT(domain_removeLtUnsafe(B, vA), 'B should be able to reflect R=0 with A');
          ASSERT(domain_removeGte(B, vA), 'B should be able to reflect R=1 with A');
          domains[indexB] = vR ? domain_removeLtUnsafe(B, vA) : domain_removeGte(B, vA);
        });
        ASSERT(!void (solveStack[solveStack.length - 1]._target = indexB));
        ASSERT(!void (solveStack[solveStack.length - 1]._meta = `${vars[indexR]} = L${vA} <=? ${vars[indexB]}`));

        ml_eliminate(ml, offset, sizeof);
        bounty_markVar(bounty, indexB);
        bounty_markVar(bounty, indexR);
        somethingChanged();
        return;
      }
    }

    pc = offset + sizeof;
  }

  function cutPlus(ml, offset) {
    ASSERT_LOG2(' -- cutPlus', offset);
    // note: we cant simply eliminate leaf vars because they still constrain
    // the allowed distance between the other two variables and if you
    // eliminate this constraint, that limitation is not enforced anymore.
    let indexR = getFinalIndex(ml_dec16(ml, offset + 1 + 2 + 2));
    ASSERT_LOG2('   - indexR=', indexR, 'counts:', bounty_getCounts(bounty, indexR), 'meta:', bounty_getMeta(bounty, indexR));
    if (cutPlusR(offset, indexR)) return;
    if (cutPlusAB(offset, indexR, 'A', 1, 'B', 1 + 2)) return;
    if (cutPlusAB(offset, indexR, 'B', 1 + 2, 'A', 1)) return;
    pc = offset + SIZEOF_VVV;
  }
  function cutPlusR(offset, indexR) {
    let countsR = bounty_getCounts(bounty, indexR);
    ASSERT_LOG2(' - cutPlusR', offset, indexR, 'count=', countsR);
    if (countsR === 1) {
      ASSERT_LOG2('   - R is a leaf var');
      // even though R is a dud, it cant be plainly eliminated!
      // however, if the range of R wraps the complete range of
      // A+B then that means the distance between A and B is not
      // restricted and we can defer this constraint, anyways.
      // (this could happen when C=A+B with C=*)
      // note that since R is a leaf var it cant be constrained
      // any further except by this constraint, so it cannot be
      // the case that another constraint invalidates this step.

      let indexA = getFinalIndex(ml_dec16(ml, offset + 1));
      let indexB = getFinalIndex(ml_dec16(ml, offset + 1 + 2));
      let A = domains[indexA];
      let B = domains[indexB];
      let R = domains[indexR];
      ASSERT_LOG2(' ->', domain__debug(R), '=', domain__debug(A), '+', domain__debug(B));

      // you could also simply add the domains and check if the result intersected with R equals the result.
      let lo = domain_min(A) + domain_min(B);
      let hi = domain_max(A) + domain_max(B);
      ASSERT(domain_min(R) >= lo, 'should be minified');
      ASSERT(domain_max(R) <= hi, 'should be minified');
      if (R === domain_createRange(lo, hi)) {
        // regardless of A and B, every addition between them is contained in R
        // this means we can eliminate R safely without breaking minimal distance A B
        solveStack.push((domains, force) => {
          ASSERT_LOG2(' - cut plus R;', indexR, '=', indexA, '+', indexB, '  ->  ', domain__debug(domains[indexR]), '=', domain__debug(domains[indexA]), '+', domain__debug(domains[indexB]));
          let vA = force(indexA);
          let vB = force(indexB);
          let vR = vA + vB;
          ASSERT(Number.isInteger(vR), 'should be integer result');
          ASSERT(domain_containsValue(domains[indexR], vR), 'A B and R should already have been reduced to domains that are valid within A+B=R', vA, vB, vR, domain__debug(domains[indexR]));
          domains[indexR] = domain_createValue(vR);
        });

        ml_eliminate(ml, pc, SIZEOF_VVV);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexB);
        bounty_markVar(bounty, indexR);
        somethingChanged();
        return true;
      }

      if (domain_isBool(A) && domain_isBool(B)) {
        if (R === domain_createRange(1, 2)) {
          ASSERT_LOG2('   - leaf R; [12]=[01]+[01] is actually an OR');
          solveStack.push((domains, force) => {
            ASSERT_LOG2(' - cut plus R=A|B;', indexR, '=', indexA, '+', indexB, '  ->  ', domain__debug(domains[indexR]), '=', domain__debug(domains[indexA]), '+', domain__debug(domains[indexB]));
            let vA = force(indexA);
            let vB = force(indexB);
            let vR = vA + vB;
            ASSERT(Number.isInteger(vR), 'should be integer result');
            ASSERT(domain_containsValue(domains[indexR], vR), 'A B and R should already have been reduced to domains that are valid within A+B=R', vA, vB, vR, domain__debug(domains[indexR]));
            domains[indexR] = domain_createValue(vR);
          });

          ASSERT_LOG2(' - Rewrite to A|B');
          // rewrite to `A | B` (inclusive OR)
          // R can later reflect the result
          // (while this won't relieve stress on A or B, it will be one less var to actively worry about)
          ml_vvv2vv(ml, offset, ML_VV_OR, indexA, indexB);
          bounty_markVar(bounty, indexR);
          somethingChanged();
          return true;
        }

        if (domain_isBool(R)) {
          ASSERT_LOG2('   - leaf R; [01]=[01]+[01] is actually a NAND');
          solveStack.push((domains, force) => {
            ASSERT_LOG2(' - cut plus R=A!&B;', indexR, '=', indexA, '+', indexB, '  ->  ', domain__debug(domains[indexR]), '=', domain__debug(domains[indexA]), '+', domain__debug(domains[indexB]));
            let vA = force(indexA);
            let vB = force(indexB);
            let vR = vA + vB;
            ASSERT(Number.isInteger(vR), 'should be integer result');
            ASSERT(domain_containsValue(domains[indexR], vR), 'A B and R should already have been reduced to domains that are valid within A+B=R', vA, vB, vR, domain__debug(domains[indexR]));
            domains[indexR] = domain_createValue(vR);
          });

          ASSERT_LOG2(' - Rewrite to A!&B');
          // rewrite to `A !& B` (not AND) to enforce that they can't both be 1 (... "non-zero")
          // R can later reflect the result
          // (while this won't relieve stress on A or B, it will be one less var to actively worry about)
          ml_vvv2vv(ml, offset, ML_VV_NAND, indexA, indexB);
          bounty_markVar(bounty, indexR);
          somethingChanged();
          return true;
        }
      }
    }

    if (countsR === 2) {
      // scan for pattern (R = A+B) & (S = R==?2) -> S = isAll(A B) when A and B are strict bools. a bit tedious to scan for but worth it.
      // (TODO: more generically it applies when all args to the plus/sum are size=2 and booly)
      let offset1 = bounty_getOffset(bounty, indexR, 0);
      let offset2 = bounty_getOffset(bounty, indexR, 1);
      let otherOffset = offset1 === offset ? offset2 : offset1;
      ASSERT(offset1 && offset2 && (offset1 === offset || offset2 === offset), 'if there were two counts Bounty should have collected two offsets for it');
      if (ml_dec8(ml, otherOffset) === ML_V8V_ISEQ && getFinalIndex(ml_dec16(ml, otherOffset + 1)) === indexR && ml_dec8(ml, otherOffset + 3) === 2) {
        // okay the "other side" is checking whether the result is 2 so if the two plus args are bools we can reduce

        let indexA = getFinalIndex(ml_dec16(ml, offset + 1));
        let indexB = getFinalIndex(ml_dec16(ml, offset + 1 + 2));
        let A = domains[indexA];
        let B = domains[indexB];

        ASSERT_LOG2(' ->', domain__debug(domains[indexR]), '=', domain__debug(A), '+', domain__debug(B));
        if (domain_isBool(A) && domain_isBool(B)) {
          ASSERT_LOG2(' - found isAll pattern, rewriting plus and eliminating isEq');
          // match. rewrite plus isAll and remove the isEq. adjust counts accordingly
          let indexS = getFinalIndex(ml_dec16(ml, otherOffset + 1 + 2 + 1)); // other op is a v8v_isEq and we want its R
          ASSERT(domain_isBool(domains[indexS]), 'S should be a bool');

          solveStack.push((domains, force) => {
            ASSERT_LOG2(' - cut plus -> isAll; ', indexR, '= isAll(', indexA, ',', indexB, ')  ->  ', domain__debug(domains[indexR]), ' = isAll(', domain__debug(domains[indexA]), ',', domain__debug(domains[indexB]), ')');
            ASSERT(domain_min(domains[indexR]) === 0 && domain_max(domains[indexR]) === 2, 'R should have all values');
            domains[indexR] = domain_createValue(force(indexA) + force(indexB));
          });

          // for the record, _this_ is why ML_ISALL2 exists at all. we cant use ML_ISALL because it has a larger footprint than ML_PLUS
          // TODO: this was before recycling was a thing. we will soon remove isall2 and use recycling instead
          ml_vvv2vvv(ml, offset, ML_ISALL2, indexA, indexB, indexS);
          ml_eliminate(ml, otherOffset, SIZEOF_V8V);
          // R=A+B, S=R==?2  ->  S=isall(A,B). so only the count for R is reduced
          bounty_markVar(bounty, indexR);
          somethingChanged();
          return true;
        }
      }
    }

    return false;
  }
  function cutPlusAB(offset, indexR, X, deltaX, Y, deltaY) {
    ASSERT_LOG2(' - _cutPlusAB:', X, Y, offset, indexR, deltaX, deltaY);
    let indexA = getFinalIndex(ml_dec16(ml, offset + deltaX));
    let countsA = bounty_getCounts(bounty, indexA);
    if (countsA === 1) {
      let A = domains[indexA];
      let indexB = getFinalIndex(ml_dec16(ml, offset + deltaY));
      let B = domains[indexB];
      let vB = domain_getValue(B);
      ASSERT_LOG2('   -', X, ' is a leaf var, ', Y, '=', domain__debug(B));
      if (vB >= 0) {
        let oR = domains[indexR];
        ASSERT_LOG2('   - and', Y, 'is solved to', vB, 'so intersect R to ' + X + '+' + vB + ', defer ' + X + ', and eliminate the constraint');
        let R = domain_intersection(domain_plus(A, B), oR);
        if (R !== oR) {
          ASSERT_LOG2(' - intersecting R with ' + X + '+vB', domain__debug(oR), 'n', (domain__debug(A) + '+' + domain__debug(B) + '=' + domain__debug(domain_plus(A, B))), '->', domain__debug(R));
          if (!R) return emptyDomain = true;
          domains[indexR] = R;
        }

        solveStack.push((domains, force) => {
          ASSERT_LOG2(' - cut plus R=' + X + '+c;', indexR, '=', indexA, '+', indexB, '  ->  ', domain__debug(domains[indexR]), '=', domain__debug(domains[indexA]), '+', domain__debug(domains[indexB]));
          let vA = force(indexA);
          let vB = force(indexB);
          let vR = vA + vB;
          ASSERT(Number.isInteger(vR), 'should be integer result');
          ASSERT(domain_containsValue(domains[indexR], vR), 'A B and R should already have been reduced to domains that are valid within A+B=R', vA, vB, vR, domain__debug(domains[indexR]));
          domains[indexR] = domain_createValue(vR);
        });

        ml_eliminate(ml, pc, SIZEOF_VVV);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexB);
        bounty_markVar(bounty, indexR);
        somethingChanged();
        return true;
      }
    }
    return false;
  }

  function cutSum(ml, offset) {
    let len = ml_dec16(ml, pc + 1);
    ASSERT(len > 2, 'should have at least three args or otherwise the minifier would have morphed it');

    let indexR = getFinalIndex(ml_dec16(ml, offset + 1 + 2 + 1 + len * 2));
    let countsR = bounty_getCounts(bounty, indexR);

    if (countsR === 1) {
      let allBool = true; // all args [01]? used later
      let C = ml_dec8(ml, offset + 1 + 2); // constant
      let lo = C;
      let hi = C;
      for (let i = 0; i < len; ++i) {
        let index = getFinalIndex(ml_dec16(ml, offset + SIZEOF_C8 + i * 2));
        let domain = domains[index];
        let min = domain_min(domain);
        let max = domain_max(domain);
        ASSERT(min < max, 'arg should not be solved here (minimizer should take care of that)');
        lo += min;
        hi += max;
        if (lo !== 0 || max !== 1) allBool = false;
      }

      let R = domains[indexR];
      ASSERT(domain_min(R) >= lo, 'R should be minimized');
      ASSERT(domain_max(R) <= hi, 'R should be minimized');

      if (R === domain_createRange(lo, hi)) {
        // all possible outcomes of summing any element in the sum args are part of R so
        // R is a leaf and the args arent bound by it so we can safely remove the sum

        // collect the arg indexes (kind of dupe loop but we'd rather not make an array prematurely)
        let args = [];
        for (let i = 0; i < len; ++i) {
          let index = getFinalIndex(ml_dec16(ml, offset + SIZEOF_C8 + i * 2));
          args.push(index);
          bounty_markVar(bounty, index);
        }

        ASSERT_LOG2('   - R is a leaf var that wraps all bounds', indexR, args, domain__debug(R));
        solveStack.push((domains, force) => {
          ASSERT_LOG2(' - cut plus R;', indexR, args, domain__debug(R));
          let vR = C + args.map(force).reduce((a, b) => a + b);
          ASSERT(Number.isInteger(vR), 'should be integer result');
          ASSERT(domain_containsValue(domains[indexR], vR), 'R should already have been reduced to a domain that is valid within any outcome of the sum', vR, domain__debug(domains[indexR]));
          domains[indexR] = domain_createValue(vR);
        });

        ml_eliminate(ml, pc, SIZEOF_C8 + len * 2 + 2);
        bounty_markVar(bounty, indexR); // args already done in above loop
        somethingChanged();
        return;
      }

      // if R is [0, n-1] and all args are [0, 1] then rewrite to a NALL
      if (allBool && lo === 0 && R === domain_createRange(0, hi - 1)) {
        // collect the arg indexes (kind of dupe loop but we'd rather not make an array prematurely)
        let args = [];
        for (let i = 0; i < len; ++i) {
          let index = getFinalIndex(ml_dec16(ml, offset + 1 + 2 + 1 + i * 2));
          args.push(index);
          bounty_markVar(bounty, index);
        }

        ASSERT_LOG2('   - R is a isNall leaf var, rewriting to NALL', indexR, args, domain__debug(R));
        solveStack.push((domains, force) => {
          ASSERT_LOG2(' - cut plus R;', indexR, args, domain__debug(R));
          let vR = C + args.map(force).reduce((a, b) => a + b);
          ASSERT(Number.isInteger(vR), 'should be integer result');
          ASSERT(domain_containsValue(domains[indexR], vR), 'R should already have been reduced to a domain that is valid within any outcome of the sum', vR, domain__debug(domains[indexR]));
          domains[indexR] = domain_createValue(vR);
        });

        // from sum to nall.
        ml_enc8(ml, offset, ML_NALL);
        ml_enc16(ml, offset + 1, len);
        for (let i = 0; i < len; ++i) {
          ml_enc16(ml, offset + SIZEOF_COUNT + i * 2, args[i]);
        }
        ml_jump(ml, offset + SIZEOF_COUNT + len * 2, 3); // result var (16bit) and the constant (8bit). for the rest nall is same as sum
        bounty_markVar(bounty, indexR); // args already done in above loop
        somethingChanged();
        return;
      }
    }

    if (countsR === 2) {
      let C = ml_dec8(ml, offset + 1 + 2); // constant
      // scan for pattern (R = sum(A B C) & (S = R==?3) -> S = isAll(A B C). a bit tedious to scan for but worth it.
      let offset1 = bounty_getOffset(bounty, indexR, 0);
      let offset2 = bounty_getOffset(bounty, indexR, 1);
      let otherOffset = offset1 === offset ? offset2 : offset1;
      ASSERT(otherOffset > 0, 'offset should exist and cant be the first op');
      if (ml_dec8(ml, otherOffset) === ML_V8V_ISEQ && getFinalIndex(ml_dec16(ml, otherOffset + 1)) === indexR && ml_dec8(ml, otherOffset + 3) === (C + len)) {
        // okay the "other side" is checking whether the result is max so if all the args are bools we can reduce

        let args = [];
        let allBools = true;
        for (let i = 0; i < len; ++i) {
          let index = getFinalIndex(ml_dec16(ml, offset + SIZEOF_C8 + i * 2));
          let domain = domains[index];
          if (!domain_isBool(domain)) {
            allBools = false;
            break;
          }
          args.push(index);
        }

        if (allBools) {
          ASSERT_LOG2(' - found isAll pattern, rewriting sum and eliminating isEq');

          // ok, we replace the sum and isEq with `S = isAll(args)`
          // the sum has the biggest footprint so the isall will fit with one byte to spare

          let indexS = getFinalIndex(ml_dec16(ml, otherOffset + 1 + 3));
          ASSERT(domains[indexS] === domain_createRange(0, 1), 'S should be a bool');

          solveStack.push((domains, force) => {
            ASSERT_LOG2(' - cut sum -> isAll');
            let vR = 0;
            for (let i = 0; i < len; ++i) {
              let vN = force(args[i]);
              ASSERT(vN === 0 || vN === 1, 'should be booly');
              if (vN) ++vR;
            }
            ASSERT(domain_min(domains[indexR]) === 0 && domain_max(domains[indexR]) === len, 'R should have all values');
            domains[indexR] = domain_createValue(vR);
          });

          // isall has no constant so we must move all args one to the left
          ml_enc8(ml, offset, ML_ISALL);
          ml_enc16(ml, offset + 1, len);
          for (let i = 0; i < len; ++i) {
            ml_enc16(ml, offset + SIZEOF_COUNT + i * 2, ml_dec16(ml, offset + SIZEOF_C8 + i * 2));
          }
          ml_enc16(ml, offset + SIZEOF_COUNT + len * 2, indexS);
          ml_jump(ml, offset + SIZEOF_COUNT + len * 2 + 2, SIZEOF_C8 - SIZEOF_COUNT); // the difference in op footprint is the 8bit constant

          // remove the iseq, regardless
          ml_eliminate(ml, otherOffset, SIZEOF_V8V);

          // R=sum(args), S=R==?2  ->  S=isall(args). so only the count for R is reduced
          bounty_markVar(bounty, indexR);
          somethingChanged();
          return;
        }
      }
    }

    pc += SIZEOF_C8 + len * 2 + 2;
  }

  function cutOr() {
    let indexA = getFinalIndex(ml_dec16(ml, pc + 1));
    let indexB = getFinalIndex(ml_dec16(ml, pc + 3));

    let countsA = bounty_getCounts(bounty, indexA);
    let countsB = bounty_getCounts(bounty, indexB);

    ASSERT_LOG2(' - cutOr', indexA, '|', indexB, 'counts:', countsA, countsB, ', meta:', bounty_getMeta(bounty, indexA), bounty_getMeta(bounty, indexB));

    if (countsA === 1) {
      ASSERT_LOG2('   - A is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut or A;', indexA, '|', indexB, '  ->  ', domain__debug(domains[indexA]), '|', domain__debug(domains[indexB]));
        let A = domains[indexA];
        let vB = force(indexB);
        ASSERT(domain_min(A) === 0 && domain_max(A) > 0, 'A should contain zero and non-zero');
        if (vB === 0) domains[indexA] = domain_removeValue(A, 0);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexA));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexA + ' | ' + indexB));

      ml_eliminate(ml, pc, SIZEOF_VV);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      somethingChanged();
      return;
    }

    if (countsB === 1) {
      ASSERT_LOG2('   - B is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut or B;', indexA, '|', indexB, '  ->  ', domain__debug(domains[indexA]), '|', domain__debug(domains[indexB]));
        let vA = force(indexA);
        let B = domains[indexB];
        ASSERT(domain_min(B) === 0 && domain_max(B) > 0, 'B should contain zero and non-zero');
        if (vA === 0) domains[indexB] = domain_removeValue(B, 0);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexB));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexA + ' | ' + indexB));

      ml_eliminate(ml, pc, SIZEOF_VV);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      somethingChanged();
      return;
    }

    pc += SIZEOF_VV;
  }

  function cutXor() {
    let indexA = getFinalIndex(ml_dec16(ml, pc + 1));
    let indexB = getFinalIndex(ml_dec16(ml, pc + 3));

    let countsA = bounty_getCounts(bounty, indexA);
    let countsB = bounty_getCounts(bounty, indexB);

    ASSERT_LOG2(' - cutXor', indexA, '^', indexB, 'counts:', countsA, countsB, ', meta:', bounty_getMeta(bounty, indexA), bounty_getMeta(bounty, indexB));

    if (countsA === 1) {
      ASSERT_LOG2('   - A is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut xor A;', indexA, '^', indexB, '  ->  ', domain__debug(domains[indexA]), '^', domain__debug(domains[indexB]));
        let A = domains[indexA];
        let vB = force(indexB);
        ASSERT(domain_min(A) === 0 && domain_max(A) > 0, 'A should contain zero and non-zero');
        if (vB === 0) domains[indexA] = domain_removeValue(A, 0);
        else domains[indexA] = domain_createValue(0);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexA));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexA + ' ^ ' + indexB));

      ml_eliminate(ml, pc, SIZEOF_VV);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      somethingChanged();
      return;
    }

    if (countsB === 1) {
      ASSERT_LOG2('   - B is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut xor B;', indexA, '^', indexB, '  ->  ', domain__debug(domains[indexA]), '^', domain__debug(domains[indexB]));
        let vA = force(indexA);
        let B = domains[indexB];
        ASSERT(domain_min(B) === 0 && domain_max(B) > 0, 'B should contain zero and non-zero');
        if (vA === 0) domains[indexB] = domain_removeValue(B, 0);
        else domains[indexB] = domain_createValue(0);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexB));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexA + ' ^ ' + indexB));

      ml_eliminate(ml, pc, SIZEOF_VV);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      somethingChanged();
      return;
    }

    pc += SIZEOF_VV;
  }

  function cutNand() {
    let indexA = getFinalIndex(ml_dec16(ml, pc + 1));
    let indexB = getFinalIndex(ml_dec16(ml, pc + 3));

    let countsA = bounty_getCounts(bounty, indexA);
    let countsB = bounty_getCounts(bounty, indexB);

    ASSERT_LOG2(' - cutNand', indexA, '!&', indexB, 'counts:', countsA, countsB, ', meta:', bounty_getMeta(bounty, indexA), bounty_getMeta(bounty, indexB));

    if (countsA === 1) {
      ASSERT_LOG2('   - A is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut nand A;', indexA, '!&', indexB, '  ->  ', domain__debug(domains[indexA]), '!&', domain__debug(domains[indexB]));
        let A = domains[indexA];
        let B = domains[indexB];
        let vB = domain_min(B) || force(indexB); // there's no need to force solve B if B doesnt contain a zero anyways
        ASSERT(domain_min(A) === 0, 'A should contain a zero (regardless)');
        if (vB > 0) domains[indexA] = domain_createValue(0);
        ASSERT_LOG2('   - result: vB=', vB, 'domain A=', domain__debug(domains[indexA]));
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexA));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexA + ' !& ' + indexB));

      ml_eliminate(ml, pc, SIZEOF_VV);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      somethingChanged();
      return;
    }

    if (countsB === 1) {
      ASSERT_LOG2('   - B is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut nand B;', indexA, '!&', indexB, '  ->  ', domain__debug(domains[indexA]), '!&', domain__debug(domains[indexB]));
        let A = domains[indexA];
        let vA = domain_min(A) || force(indexA); // there's no need to force solve A if A doesnt contain a zero anyways
        let B = domains[indexB];
        ASSERT(domain_min(B) === 0, 'A should contain a zero (regardless)');
        if (vA > 0) domains[indexB] = domain_createValue(0);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexB));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexA + ' !& ' + indexB));

      ml_eliminate(ml, pc, SIZEOF_VV);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      somethingChanged();
      return;
    }

    let metaA = bounty_getMeta(bounty, indexA);
    let metaB = bounty_getMeta(bounty, indexB);

    if (metaA === BOUNTY_NAND) {
      // A is only used in nands. eliminate them all and defer A
      if (trickNandOnly(indexA, pc)) return;
    }

    if (metaB === BOUNTY_NAND) {
      // B is only used in nands. eliminate them all and defer B
      if (trickNandOnly(indexB, pc)) return;
    }

    if (countsA === 2) {
      if ((metaA & BOUNTY_LTE_LHS) && trickNandLteLhs(indexA, pc, 'nand')) return;
    }

    if (countsB === 2) {
      if ((metaB & BOUNTY_LTE_LHS) && trickNandLteLhs(indexB, pc, 'nand')) return;
    }

    if ((metaA & BOUNTY_ISALL_RESULT) && trickNandIsall(indexA, indexB, pc)) return;
    if ((metaB & BOUNTY_ISALL_RESULT) && trickNandIsall(indexB, indexA, pc)) return;

    pc += SIZEOF_VV;
  }

  function cutXnor() {
    let indexA = getFinalIndex(ml_dec16(ml, pc + 1));
    let indexB = getFinalIndex(ml_dec16(ml, pc + 3));

    let countsA = bounty_getCounts(bounty, indexA);
    let countsB = bounty_getCounts(bounty, indexB);

    ASSERT_LOG2(' - cutXnor', indexA, '!^', indexB, 'counts:', countsA, countsB, ', meta:', bounty_getMeta(bounty, indexA), bounty_getMeta(bounty, indexB));

    if (countsA === 1) {
      ASSERT_LOG2('   - A is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut xnor A;', indexA, '!^', indexB, '  ->  ', domain__debug(domains[indexA]), '!^', domain__debug(domains[indexB]));
        let A = domains[indexA];
        let B = domains[indexB];
        let vB = domain_min(B) || force(indexB); // no need to force solve B if B has no zero anyways
        ASSERT(domain_min(A) === 0 && domain_max(A) > 0, 'A should contain zero and non-zero');
        if (vB === 0) domains[indexA] = domain_createValue(0);
        else domains[indexA] = domain_removeValue(A, 0);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexA));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexA + ' !^ ' + indexB));

      ml_eliminate(ml, pc, SIZEOF_VV);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      somethingChanged();
      return;
    }

    if (countsB === 1) {
      ASSERT_LOG2('   - B is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut xnor B;', indexA, '!^', indexB, '  ->  ', domain__debug(domains[indexA]), '!^', domain__debug(domains[indexB]));
        let A = domains[indexA];
        let vA = domain_min(A) || force(indexA); // no need to force solve A if A has no zero anyways
        let B = domains[indexB];
        ASSERT(domain_min(B) === 0 && domain_max(B) > 0, 'B should contain zero and non-zero');
        if (vA === 0) domains[indexB] = domain_createValue(0);
        else domains[indexB] = domain_removeValue(B, 0);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexB));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexA + ' !^ ' + indexB));

      ml_eliminate(ml, pc, SIZEOF_VV);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      somethingChanged();
      return;
    }

    let metaA = bounty_getMeta(bounty, indexA);
    let metaB = bounty_getMeta(bounty, indexB);
    let boolyA = !(metaA & BOUNTY_NOT_BOOLY);
    let boolyB = !(metaB & BOUNTY_NOT_BOOLY);
    if (boolyA || boolyB) {
      // A or B is only used as a boolean (in the zero-nonzero sense, not strictly 0,1)
      // the xnor basically says that if one is zero the other one is too, and otherwise neither is zero
      // cominbing that with the knowledge that both vars are only used for zero-nonzero, one can be
      // considered a pseudo-alias for the other. we replace it with the other var and defer solving it.
      // when possible, pick a strictly boolean domain because it's more likely to allow new tricks.
      // note that for the bool, the actual value is irrelevant. whether it's 1 or 5, the ops will
      // normalize this to zero and non-zero anyways. and by assertion there are no other ops.

      ASSERT_LOG2(' - found bool-eq in a xnor:', indexA, '!^', indexB, '->', metaA, metaB);

      // ok, a little tricky, but we're going to consider the bool to be a full alias of the other var
      // only when creating a solution, we will override the value and apply the boolean-esque value
      // to the bool var and assign it either its zero or nonzero value.

      let indexE = indexB;
      let indexK = indexA;
      if (!boolyB || (boolyA && domain_isBool(domains[indexA]))) { // if A wasnt booly use B, otherwise A must be booly
        indexE = indexA;
        indexK = indexB;
      }
      let E = domains[indexE]; // remember what E was because it will be replaced by false to mark it an alias
      ASSERT_LOG2(' - pseudo-alias for booly xnor arg;', indexA, '!^', indexB, '  ->  ', domain__debug(domains[indexA]), '!^', domain__debug(domains[indexB]), 'replacing', indexE, 'with', indexK);

      solveStack.push((domains, force, getDomain) => {
        ASSERT_LOG2(' - resolve booly xnor arg;', indexK, '!^', indexE, '  ->  ', domain__debug(getDomain(indexK)), '!^', domain__debug(E));
        ASSERT(domain_min(E) === 0 && domain_max(E) > 0, 'the E var should be a booly', indexE, domain__debug(E));
        let vK = force(indexK);
        if (vK === 0) domains[indexE] = domain_removeGtUnsafe(E, 0);
        else domains[indexE] = domain_removeValue(E, 0);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexE));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexA + ' !^ ' + indexB));

      // note: addAlias will push a defer as well. since the defers are resolved in reverse order,
      // we must call addAlias after adding our own defer, otherwise our change will be lost.
      addAlias(indexE, indexK);

      ml_eliminate(ml, pc, SIZEOF_VV);
      // we can add the count of E to that of K and subtract two for eliminating this constraint (due to alias is now identity hence -2)
      bounty_markVar(bounty, indexK);
      bounty_markVar(bounty, indexE);
      somethingChanged();
      return;
    }

    pc += SIZEOF_VV;
  }

  function cutIsAll() {
    let len = ml_dec16(ml, pc + 1);
    let indexR = getFinalIndex(ml_dec16(ml, pc + SIZEOF_COUNT + len * 2));
    let countsR = bounty_getCounts(bounty, indexR);

    ASSERT_LOG2(' - cutIsAll', indexR, '->', countsR, 'x');

    if (countsR === 1) {
      ASSERT_LOG2('   - R is a leaf var');

      let args = [];
      for (let i = 0; i < len; ++i) {
        args.push(getFinalIndex(ml_dec16(ml, pc + 3 + i * 2)));
      }

      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut isall R; ', indexR, '= isAll(', args, ')  ->  ', domain__debug(domains[indexR]), ' = isAll(', args.map(index => domain__debug(domains[index])), ')');
        ASSERT(domains[indexR] === domain_createRange(0, 1), 'R should contain all valid values', domain__debug(domains[indexR]));

        let vR = 1;
        for (let i = 0; i < len; ++i) {
          if (force(args[i]) === 0) {
            vR = 0;
            break;
          }
        }

        domains[indexR] = domain_createValue(vR);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexR));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexR + '= isall(' + args + ')'));

      ml_eliminate(ml, pc, SIZEOF_COUNT + len * 2 + 2);
      bounty_markVar(bounty, indexR);
      for (let i = 0; i < len; ++i) {
        bounty_markVar(bounty, args[i]);
      }
      somethingChanged();

      return;
    }

    if (countsR === 2) {
      let metaR = bounty_getMeta(bounty, indexR);
      if ((metaR & BOUNTY_NALL) && trickIsallNall(indexR, pc, 'isall')) return;
    }

    pc += SIZEOF_COUNT + len * 2 + 2;
  }

  function cutIsAll2() {
    let indexR = getFinalIndex(ml_dec16(ml, pc + 5));
    let countsR = bounty_getCounts(bounty, indexR);

    ASSERT_LOG2(' - cutIsAll2', indexR, '->', countsR, 'x');

    if (countsR === 1) {
      let indexA = getFinalIndex(ml_dec16(ml, pc + 1));
      let indexB = getFinalIndex(ml_dec16(ml, pc + 3));

      ASSERT_LOG2('   - R is a leaf var');
      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut isall2 R; ', indexR, '= isAll(', indexA, ',', indexB, ')  ->  ', domain__debug(domains[indexR]), ' = isAll(', domain__debug(domains[indexA]), ',', domain__debug(domains[indexB]), ')');
        let vR = (force(indexA) === 0 || force(indexB) === 0) ? 0 : 1;
        ASSERT(domains[indexR] === domain_createRange(0, 1), 'R should be bool');
        domains[indexR] = domain_createValue(vR);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexR));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexR + '= isall(' + indexA + ',' + indexB + ')'));

      ml_eliminate(ml, pc, SIZEOF_VVV);
      bounty_markVar(bounty, indexA);
      bounty_markVar(bounty, indexB);
      bounty_markVar(bounty, indexR);
      somethingChanged();
      return;
    }

    if (countsR === 2) {
      let metaR = bounty_getMeta(bounty, indexR);
      if ((metaR & BOUNTY_NALL) && trickIsallNall(indexR, pc, 'isall')) return;
    }

    pc += SIZEOF_VVV;
  }

  function cutIsNall() {
    let len = ml_dec16(ml, pc + 1);
    let indexR = getFinalIndex(ml_dec16(ml, pc + SIZEOF_COUNT + len * 2));
    let countsR = bounty_getCounts(bounty, indexR);

    ASSERT_LOG2(' - cutIsNall', indexR, '->', countsR, 'x');

    if (countsR === 1) {
      ASSERT_LOG2('   - R is a leaf var');

      let args = [];
      for (let i = 0; i < len; ++i) {
        args.push(getFinalIndex(ml_dec16(ml, pc + 3 + i * 2)));
      }

      solveStack.push((domains, force) => {
        ASSERT_LOG2(' - cut isnall R; ', indexR, '= isNall(', args, ')  ->  ', domain__debug(domains[indexR]), ' = isNall(', args.map(index => domain__debug(domains[index])), ')');
        ASSERT(domains[indexR] === domain_createRange(0, 1), 'R should contain all valid values');

        let vR = 0;
        for (let i = 0; i < len; ++i) {
          if (force(args[i]) === 0) {
            vR = 1;
            break;
          }
        }

        domains[indexR] = domain_createValue(vR);
      });
      ASSERT(!void (solveStack[solveStack.length - 1]._target = indexR));
      ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexR + '= isnall(' + args + ')'));

      ml_eliminate(ml, pc, SIZEOF_COUNT + len * 2 + 2);
      bounty_markVar(bounty, indexR);
      for (let i = 0; i < len; ++i) {
        bounty_markVar(bounty, args[i]);
      }
      somethingChanged();
      return;
    }

    pc += SIZEOF_COUNT + len * 2 + 2;
  }

  function cutNall() {
    let len = ml_dec16(ml, pc + 1);

    for (let i = 0; i < len; ++i) {
      let index = ml_dec16(ml, pc + 3 + i * 2);
      let countsi = bounty_getCounts(bounty, index);

      if (countsi === 2) {
        let meta = bounty_getMeta(bounty, index);
        if ((meta & BOUNTY_ISALL_RESULT) && trickIsallNall(index, pc, 'nall')) return;
      }
    }

    pc += SIZEOF_COUNT + len * 2;
  }

  function leafNeq(ml, indexA, indexB) {
    ASSERT_LOG2('   - leafNeq; A is a leaf var, A != B,', indexA, '!=', indexB);
    solveStack.push((domains, force) => {
      ASSERT_LOG2(' - leafNeq; solving', indexA, '!=', indexB, '  ->  ', domain__debug(domains[indexA]), '!=', domain__debug(domains[indexB]));
      let A = domains[indexA];
      let vB = force(indexB);
      domains[indexA] = domain_removeValue(A, vB);
    });
    ASSERT(!void (solveStack[solveStack.length - 1]._target = indexA));
    ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexA + ' != ' + indexB));
    ml_eliminate(ml, pc, SIZEOF_VV);
    bounty_markVar(bounty, indexA);
    bounty_markVar(bounty, indexB);
    somethingChanged();
  }

  function leafLteLhs(ml, indexA, indexB) {
    ASSERT_LOG2('   - A is a leaf var');
    solveStack.push((domains, force) => {
      ASSERT_LOG2(' - cut lte A;', indexA, '<=', indexB, '  ->  ', domain__debug(domains[indexA]), '<=', domain__debug(domains[indexB]));
      let A = domains[indexA];
      let vB = force(indexB);
      domains[indexA] = domain_removeGtUnsafe(A, vB);
    });
    ASSERT(!void (solveStack[solveStack.length - 1]._target = indexA));
    ASSERT(!void (solveStack[solveStack.length - 1]._meta = indexA + ' <= ' + indexB));
    ml_eliminate(ml, pc, SIZEOF_VV);
    bounty_markVar(bounty, indexA);
    bounty_markVar(bounty, indexB);
    somethingChanged();
  }

  function leafLteRhs(ml, indexA, indexB) {
    ASSERT_LOG2('   - B is a leaf var');
    solveStack.push((domains, force) => {
      ASSERT_LOG2(' - cut lte B;', indexA, '<=', indexB, '  ->  ', domain__debug(domains[indexA]), '<=', domain__debug(domains[indexB]));
      let vA = force(indexA);
      let B = domains[indexB];
      domains[indexB] = domain_removeLtUnsafe(B, vA);
    });
    ASSERT(!void (solveStack[solveStack.length - 1]._target = indexB));
    ASSERT(!void (solveStack[solveStack.length - 1]._meta = `${indexA} <= ${indexB}`));
    ml_eliminate(ml, pc, SIZEOF_VV);
    bounty_markVar(bounty, indexA);
    bounty_markVar(bounty, indexB);
    somethingChanged();
  }

  function trickLteLhsTwice(varIndex, offset, meta) {
    let offset1 = bounty_getOffset(bounty, varIndex, 0);
    let offset2 = bounty_getOffset(bounty, varIndex, 1);
    ASSERT(offset === offset1 || offset === offset2, 'expecting current offset to be one of the two offsets found', offset, varIndex, meta);


    ASSERT_LOG2('trickLteLhsTwice', varIndex, 'at', offset, 'and', offset1, '/', offset2, 'metaFlags:', meta);

    if (offset !== offset1 && ml_dec8(ml, offset1) !== ML_VV_LTE) {
      ASSERT_LOG2(' - offset1 wasnt lte');
      return false;
    }

    if (offset !== offset2 && ml_dec8(ml, offset2) !== ML_VV_LTE) {
      ASSERT_LOG2(' - offset2 wasnt lte');
      return false;
    }

    if (ml_dec16(ml, offset1 + 1) !== varIndex) {
      ASSERT_LOG2(' - indexA of 1 wasnt the shared index');
      return false;
    }

    if (ml_dec16(ml, offset1 + 1) !== varIndex) {
      ASSERT_LOG2(' - indexA of 2 wasnt the shared index');
      return false;
    }

    let indexB1 = getFinalIndex(ml_dec16(ml, offset1 + 3));
    let indexB2 = getFinalIndex(ml_dec16(ml, offset2 + 3));

    if (domain_max(domains[indexB1]) > 1 || domain_max(domains[indexB2]) > 1) {
      ASSERT_LOG2(' - only works on boolean domains'); // well not only, but there are some edge cases otherwise
      return false;
    }

    // okay, two lte with the left being the shared index
    // the shared index is a leaf var, eliminate them both

    ml_eliminate(ml, offset1, SIZEOF_VV);
    ml_eliminate(ml, offset2, SIZEOF_VV);

    ASSERT_LOG2(' - A is a leaf constraint, defer it', varIndex);

    solveStack.push((domains, force) => {
      ASSERT_LOG2(' - 2xlte;1;', varIndex, '!&', indexB1, '  ->  ', domain__debug(domains[varIndex]), '<=', domain__debug(domains[indexB1]));
      ASSERT_LOG2(' - 2xlte;2;', varIndex, '!&', indexB2, '  ->  ', domain__debug(domains[varIndex]), '<=', domain__debug(domains[indexB2]));

      domains[varIndex] = domain_removeGtUnsafe(domain_removeGtUnsafe(domains[varIndex], force(indexB1)), force(indexB2));
    });

    bounty_markVar(bounty, varIndex);
    bounty_markVar(bounty, indexB1);
    bounty_markVar(bounty, indexB2);
    somethingChanged();
    return true;
  }

  function trickIsallLteRhs(varIndex, lteOffset) {
    let offset1 = bounty_getOffset(bounty, varIndex, 0);
    let offset2 = bounty_getOffset(bounty, varIndex, 1);
    ASSERT(lteOffset === offset1 || lteOffset === offset2, 'expecting current offset to be one of the two offsets found', lteOffset, varIndex);

    ASSERT_LOG2('trickIsallLteRhs', varIndex, 'at', lteOffset, '->', offset1, offset2);

    return _trickIsallLteRhs(varIndex, lteOffset, lteOffset === offset1 ? offset2 : offset1);
  }
  function _trickIsallLteRhs(varIndex, lteOffset, isallOffset) {
    // we can replace an isall and lte with ltes on the args of the isall
    // B = isall(C D), A <= B  ->   A <= C, A <= D
    // (where B is sharedVarIndex)
    // if A turns out to be a leaf var for only being lte_lhs then
    // everything will dissolve through another trick function
    // (only) the isall args are assumed to be booly (containing both zero and non-zero)
    // A <= B meaning A is 0 when B is 0. B is 0 when C or D is 0 and non-zero
    // otherwise. so A <= C or A <= D should force A to match A <= B.

    // first check whether the offsets are still valid (an lte_lhs trick may have removed/updated the lte for example)

    ASSERT_LOG2(' - checking lte offset', ml_dec8(ml, lteOffset) === ML_VV_LTE);
    if (ml_dec8(ml, lteOffset) !== ML_VV_LTE) {
      ASSERT_LOG2(' - no longer lte. bailing.');
      return false;
    }

    if (ml_dec16(ml, lteOffset + 3) !== varIndex) {
      ASSERT_LOG2(' - shared var was not rhs of the lte');
      return false;
    }

    let indexA = getFinalIndex(ml_dec16(ml, lteOffset + 1));

    ASSERT_LOG2(' - checking isall offset', ml_dec8(ml, isallOffset) === ML_ISALL, ', indexA =', indexA);
    // there are two isalls, need special paths because of different footprints
    if (ml_dec8(ml, isallOffset) === ML_ISALL) {
      let len = ml_dec16(ml, isallOffset + 1);

      if (ml_dec16(ml, isallOffset + SIZEOF_COUNT + len * 2) !== varIndex) {
        ASSERT_LOG2(' - shared var was not result var of the isall');
        return false;
      }

      ASSERT_LOG2(' - rewriting B=isall(C D), A <= B  ->  A <= C, A <= D');

      // 2 ltes fit perfectly in the space we have available (sizeof(isall on 2)=9 + sizeof(lte)=5, sizeof(2xlte)=10)
      if (len === 2) {
        let left = getFinalIndex(ml_dec16(ml, isallOffset + 3));
        let right = getFinalIndex(ml_dec16(ml, isallOffset + 5));

        // validate domains. for now, only apply the trick on strict bools [0 1]. only required for the isall args.
        ASSERT_LOG2(' - confirming all targeted vars are strict bools', domain__debug(domains[indexA]), domain__debug(domains[left]), domain__debug(domains[right]));
        if (domain_isBool(domains[left]) && domain_isBool(domains[right])) {
          // compile A<=left and A<=right over the existing two offsets
          ml_vv2vv(ml, lteOffset, ML_VV_LTE, indexA, left);
          ml_cr2vv(ml, isallOffset, len, ML_VV_LTE, indexA, right);

          // must mark all affected vars. their bounty data is probably obsolete now.
          bounty_markVar(bounty, indexA);
          bounty_markVar(bounty, left); // C
          bounty_markVar(bounty, right); // D
          bounty_markVar(bounty, varIndex);
          somethingChanged();

          return trickIsallLteRhsDeferShared(varIndex, indexA);
        }
      } else if (len < 100) {
        ASSERT_LOG2(' - Attempting to recycle space to stuff', len, 'lte constraints');
        // we have to recycle some space now. 100 is an arbitrary upper bound. the actual bound is the available space to recycle

        // start by collecting len recycled spaces
        let bin = []; // rare case of using an array inside this lib...
        let leftToStore = len;
        let lteSize = SIZEOF_VV; // lte vv
        let nextOffset = 0;
        let spaceLeft = 0;
        let nextSize = 0;
        do {
          if (spaceLeft < lteSize) {
            nextOffset = ml_getRecycleOffset(ml, nextOffset + nextSize, lteSize);
            ASSERT_LOG2('     - Got a new recyclable offset:', nextOffset);
            if (nextOffset === undefined) {
              // not enough spaces to recycle to fill our need; we can't rewrite this one
              ASSERT_LOG2('     - There is not enough space to recycle; bailing this morph');
              return false;
            }
            nextSize = ml_getOpSizeSlow(ml, nextOffset); // probably larger than requested because jumps are consolidated
            spaceLeft = nextSize;
            ASSERT_LOG2('     - It has', nextSize, 'bytes of free space');

            bin.push(nextOffset);
          }
          spaceLeft -= lteSize;
          --leftToStore;
          ASSERT_LOG2('   - Space left at', nextOffset, 'after compiling the LTE:', spaceLeft, ', LTEs left to store:', leftToStore);
        } while (leftToStore > 0);

        ASSERT_LOG2(' - Found', bin.length, 'jumps (', bin, ') which can host the', len, 'lte constraints. Compiling them now');

        // confirm all isall args are bool
        for (let i = 0; i < len; ++i) {
          let indexB = getFinalIndex(ml_dec16(ml, isallOffset + SIZEOF_COUNT + i * 2));
          if (domain_max(domains[indexB]) > 1) {
            ASSERT_LOG2('     - not all isall args are bool so bailing this morph');
            return false;
          }
        }

        let recycleOffset;
        let currentSize = 0;
        for (let i = 0; i < len; ++i) {
          ASSERT_LOG2('   - Compiling an lte to offset=', recycleOffset, 'with remaining size=', currentSize);
          if (currentSize < SIZEOF_VV) {
            recycleOffset = bin.pop(); // note: doing it backwards means we may not deplete the bin if the last space can host more lte's than were left to assign in the last loop. but that's fine either way.
            currentSize = ml_getOpSizeSlow(ml, recycleOffset);
            ASSERT_LOG2('   - Fetched next space from bin; offset=', recycleOffset, 'with size=', currentSize);
          }
          let indexB = ml_dec16(ml, isallOffset + SIZEOF_COUNT + i * 2);
          ASSERT_LOG2('- Compiling LTE in recycled space', recycleOffset, 'on AB', indexA, indexB);
          ml_recycleVV(ml, recycleOffset, ML_VV_LTE, indexA, indexB);
          recycleOffset += SIZEOF_VV;
          currentSize -= SIZEOF_VV;
          bounty_markVar(bounty, indexB);

          ASSERT(!void ml_validateSkeleton(ml), 'just making sure the recycle didnt screw up');
        }

        // TODO: we could recycle these addresses immediately. slightly more efficient and may cover the edge case where there otherwise wouldnt be enough space.
        ml_eliminate(ml, isallOffset, SIZEOF_COUNT + len * 2 + 2);
        ml_eliminate(ml, lteOffset, SIZEOF_VV);

        // the other vars were marked in the last loop
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, varIndex);
        somethingChanged();

        ASSERT(!void ml_validateSkeleton(ml), 'just making sure the recycle didnt screw up');
        return trickIsallLteRhsDeferShared(varIndex, indexA);
      }
    }

    ASSERT_LOG2(' - checking isall offset for other op', ml_dec8(ml, isallOffset) === ML_ISALL2, ', indexA =', indexA);
    if (ml_dec8(ml, isallOffset) === ML_ISALL2) {
      if (ml_dec16(ml, isallOffset + 5) !== varIndex) {
        ASSERT_LOG2(' - shared var was not result var of the isall, this is probably an old addr');
        return false;
      }
      let left = getFinalIndex(ml_dec16(ml, isallOffset + 1));
      let right = getFinalIndex(ml_dec16(ml, isallOffset + 3));

      // validate domains. for now, only apply the trick on strict bools [0 1] for the isall args
      ASSERT_LOG2(' - confirming all targeted vars are strict bools', domain__debug(domains[indexA]), domain__debug(domains[left]), domain__debug(domains[right]));
      if (domain_isBool(domains[left]) && domain_isBool(domains[right])) {
        // compile A<=left and A<=right over the existing two offsets
        ml_vv2vv(ml, lteOffset, ML_VV_LTE, varIndex, left);
        ml_vvv2vv(ml, isallOffset, ML_VV_LTE, varIndex, right);
        bounty_markVar(bounty, left);
        bounty_markVar(bounty, right);
        bounty_markVar(bounty, varIndex);
        somethingChanged();

        return trickIsallLteRhsDeferShared(varIndex, indexA);
      }
    }

    ASSERT_LOG2(' - was not isall. bailing.');
    return false;
  }
  function trickIsallLteRhsDeferShared(varIndex, lteIndex) {
    // TODO: this has to check the isall args because lte is not strict enough
    ASSERT_LOG2('   - deferring', varIndex, 'will be gt', lteIndex);
    solveStack.push((domains, force) => {
      THROW('fixme');
      ASSERT_LOG2(' - isall + lte;', lteIndex, '<=', varIndex, '  ->  ', domain__debug(domains[lteIndex]), '<=', domain__debug(domains[varIndex]));
      let vA = force(lteIndex);
      domains[varIndex] = domain_removeGtUnsafe(domains[varIndex], vA);
    });
    ASSERT(!void (solveStack[solveStack.length - 1]._target = varIndex));
    ASSERT(!void (solveStack[solveStack.length - 1]._meta = `${lteIndex} <= ${varIndex}`));

    // revisit this op, it is now an lte
    return true;
  }

  function trickIsallNall(varIndex, offset, forOp) {
    let offset1 = bounty_getOffset(bounty, varIndex, 0);
    let offset2 = bounty_getOffset(bounty, varIndex, 1);
    ASSERT(offset === offset1 || offset === offset2, 'expecting current offset to be one of the two offsets found', offset, varIndex);

    ASSERT_LOG2('trickIsallNall', varIndex, 'at', offset, 'and', offset1, '/', offset2, 'metaFlags:', bounty_getMeta(bounty, varIndex));

    let nallOffset = (forOp === 'nall' && offset === offset1) ? offset1 : offset2;
    let isallOffset = (forOp !== 'nall' && offset === offset1) ? offset1 : offset2;

    // this should be `R = all?(A B), nall(R A D)`
    // if R = 1 then A and B are 1, so the nall will have two 1's, meaning D must be 0
    // if R = 0 then the nall is already satisfied. the nall is not entirely redundant
    // because `R !& D` must be maintained, so rewrite it to a nand (or rather, remove B from it)

    ASSERT_LOG2(' - checking nall offset', ml_dec8(ml, nallOffset) === ML_NALL);
    if (ml_dec8(ml, nallOffset) !== ML_NALL) {
      ASSERT_LOG2(' - op wasnt nall so bailing');
      return false;
    }

    ASSERT_LOG2(' - checking isall offset', ml_dec8(ml, isallOffset) === ML_ISALL);
    if (ml_dec8(ml, isallOffset) === ML_ISALL) {
      ASSERT_LOG2(' - the ops match. now fingerprint them');
      // initially, for this we need a nall of 3 and a isall of 2
      let nallLen = ml_dec16(ml, nallOffset + 1);
      let isallLen = ml_dec16(ml, isallOffset + 1);

      if (nallLen !== 3 || isallLen !== 2) {
        ASSERT_LOG2(' - fingerprint didnt match so bailing');
        return false;
      }

      ASSERT_LOG2(' - nall has 3 and isall 2 args, check if they share an arg');
      // next; one of the two isalls must occur in the nall
      // letters; S = all?(A B), nall(S C D)   (where S = shared)
      let indexS = varIndex;
      if (ml_dec16(ml, isallOffset + 7) !== indexS) {
        ASSERT_LOG2(' - this is NOT the isall we were looking at before because the shared index is not part of it');
        return false;
      }
      let indexA = ml_dec16(ml, isallOffset + 3);
      let indexB = ml_dec16(ml, isallOffset + 5);

      let indexC;
      let indexD;

      let indexN1 = ml_dec16(ml, nallOffset + 3);
      let indexN2 = ml_dec16(ml, nallOffset + 5);
      let indexN3 = ml_dec16(ml, nallOffset + 7); // need to verify this anyways
      if (indexN1 === indexS) {
        indexC = indexN2;
        indexD = indexN3;
      } else if (indexN2 === indexS) {
        indexC = indexN1;
        indexD = indexN3;
      } else if (indexN3 === indexS) {
        indexC = indexN1;
        indexD = indexN2;
      } else {
        ASSERT_LOG2(' - this is NOT the nall we were looking at before because the shared index is not part of it');
        return false;
      }

      ASSERT_LOG2(' - nall(', indexS, indexC, indexD, ') and ', indexS, ' = all?(', indexA, indexB, ')');

      // check if B or D is in the isall. apply morph by cutting out the one that matches
      if (indexA === indexC) {
        ASSERT_LOG2(' - A=C so removing', indexA, 'from the nall and changing it to a nand');
        ml_c2vv(ml, nallOffset, nallLen, ML_VV_NAND, indexS, indexD);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexB);
        bounty_markVar(bounty, indexC);
        bounty_markVar(bounty, indexD);
        bounty_markVar(bounty, varIndex);
        somethingChanged();
        return true;
      }
      if (indexA === indexD) {
        ASSERT_LOG2(' - A=D so removing', indexA, 'from the nall and changing it to a nand');
        ml_c2vv(ml, nallOffset, nallLen, ML_VV_NAND, indexS, indexC);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexB);
        bounty_markVar(bounty, indexC);
        bounty_markVar(bounty, indexD);
        bounty_markVar(bounty, varIndex);
        somethingChanged();
        return true;
      }
      if (indexB === indexC) {
        ASSERT_LOG2(' - B=C so removing', indexB, 'from the nall and changing it to a nand');
        ml_c2vv(ml, nallOffset, nallLen, ML_VV_NAND, indexS, indexD);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexB);
        bounty_markVar(bounty, indexC);
        bounty_markVar(bounty, indexD);
        bounty_markVar(bounty, varIndex);
        somethingChanged();
        return true;
      }
      if (indexB === indexD) {
        ASSERT_LOG2(' - B=D so removing', indexB, 'from the nall and changing it to a nand');
        ml_c2vv(ml, nallOffset, nallLen, ML_VV_NAND, indexS, indexC);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexB);
        bounty_markVar(bounty, indexC);
        bounty_markVar(bounty, indexD);
        bounty_markVar(bounty, varIndex);
        somethingChanged();
        return true;
      }
    }
    ASSERT_LOG2(' - checking isall2 offset', ml_dec8(ml, isallOffset) === ML_ISALL);
    if (ml_dec8(ml, isallOffset) === ML_ISALL2) {
      ASSERT_LOG2(' - the ops match. now fingerprint them');
      // initially, for this we need a nall of 3 and a isall of 2 (which the op tells us already)
      let nallLen = ml_dec16(ml, nallOffset + 1);

      if (nallLen !== 3) {
        ASSERT_LOG2(' - fingerprint did not match so bailing');
        return false;
      }

      ASSERT_LOG2(' - nall has 3 and isall2 ... 2 args, check if they share an arg');
      // next; one of the two isalls must occur in the nall
      // letters; S = all?(A B), nall(S C D)   (where S = shared)
      let indexS = varIndex;
      if (ml_dec16(ml, isallOffset + 5) !== indexS) {
        ASSERT_LOG2(' - this is NOT the isall we were looking at before because the shared index is not part of it');
        return false;
      }
      let indexA = ml_dec16(ml, isallOffset + 1);
      let indexB = ml_dec16(ml, isallOffset + 3);

      let indexC;
      let indexD;

      let indexN1 = ml_dec16(ml, nallOffset + 3);
      let indexN2 = ml_dec16(ml, nallOffset + 5);
      let indexN3 = ml_dec16(ml, nallOffset + 7); // need to verify this anyways
      if (indexN1 === indexS) {
        indexC = indexN2;
        indexD = indexN3;
      } else if (indexN2 === indexS) {
        indexC = indexN1;
        indexD = indexN3;
      } else if (indexN3 === indexS) {
        indexC = indexN1;
        indexD = indexN2;
      } else {
        ASSERT_LOG2(' - this is NOT the nall we were looking at before because the shared index is not part of it');
        return false;
      }

      ASSERT_LOG2(' - nall(', indexS, indexC, indexD, ') and ', indexS, ' = all?(', indexA, indexB, ')');

      // check if B or D is in the isall. apply morph by cutting out the one that matches
      if (indexA === indexC) {
        ASSERT_LOG2(' - A=C so removing', indexA, 'from the nall');
        ml_c2vv(ml, nallOffset, nallLen, ML_VV_NAND, indexS, indexD);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexB);
        bounty_markVar(bounty, indexD);
        bounty_markVar(bounty, varIndex);
        somethingChanged();
        return true;
      }
      if (indexA === indexD) {
        ASSERT_LOG2(' - A=D so removing', indexA, 'from the nall');
        ml_c2vv(ml, nallOffset, nallLen, ML_VV_NAND, indexS, indexC);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexB);
        bounty_markVar(bounty, indexC);
        bounty_markVar(bounty, varIndex);
        somethingChanged();
        return true;
      }
      if (indexB === indexC) {
        ASSERT_LOG2(' - B=C so removing', indexB, 'from the nall');
        ml_c2vv(ml, nallOffset, nallLen, ML_VV_NAND, indexS, indexD);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexB);
        bounty_markVar(bounty, indexC);
        bounty_markVar(bounty, varIndex);
        somethingChanged();
        return true;
      }
      if (indexB === indexD) {
        ASSERT_LOG2(' - B=D so removing', indexB, 'from the nall');
        ml_c2vv(ml, nallOffset, nallLen, ML_VV_NAND, indexS, indexC);
        bounty_markVar(bounty, indexA);
        bounty_markVar(bounty, indexB);
        bounty_markVar(bounty, indexC);
        bounty_markVar(bounty, varIndex);
        somethingChanged();
        return true;
      }
    }

    return false;
  }

  function trickNandLteLhs(varIndex, offset, forOp) {
    let offset1 = bounty_getOffset(bounty, varIndex, 0);
    let offset2 = bounty_getOffset(bounty, varIndex, 1);
    ASSERT(offset === offset1 || offset === offset2, 'expecting current offset to be one of the two offsets found', offset, varIndex);

    // this should be `A <= B, A !& C`. A is a leaf var, eliminate both constraints and defer A.

    let lteOffset = (forOp === 'lte' && offset === offset1) ? offset1 : offset2;
    let nandOffset = (forOp !== 'lte' && offset === offset1) ? offset1 : offset2;

    ASSERT_LOG2(' - checking lte offset', ml_dec8(ml, lteOffset) === ML_VV_LTE);
    if (ml_dec8(ml, lteOffset) !== ML_VV_LTE) {
      ASSERT_LOG2(' - op wasnt lte so bailing');
      return false;
    }

    if (ml_dec16(ml, lteOffset + 1) !== varIndex) {
      ASSERT_LOG2(' - shared var should be left var of the lte but wasnt, probably old addr');
      return false;
    }

    let indexB = getFinalIndex(ml_dec16(ml, lteOffset + 3));

    ASSERT_LOG2(' - checking nand offset', ml_dec8(ml, nandOffset) === ML_VV_NAND, ', indexA =', indexB);
    if (ml_dec8(ml, nandOffset) !== ML_VV_NAND) {
      ASSERT_LOG2(' - op wasnt nand so bailing');
      return false;
    }

    let left = getFinalIndex(ml_dec16(ml, nandOffset + 1));
    let right = getFinalIndex(ml_dec16(ml, nandOffset + 3));

    if (left !== varIndex && right !== varIndex) {
      ASSERT_LOG2(' - shared var should be part of the nand but wasnt, probably old addr');
      return false;
    }

    ASSERT_LOG2(' - asserting strict boolean domains', domain__debug(domains[indexB]), domain__debug(domains[left]), domain__debug(domains[right]));
    if (!domain_isBool(domains[indexB]) || !domain_isBool(domains[left]) || !domain_isBool(domains[right])) {
      ASSERT_LOG2(' - at least some arg wasnt bool so bailing');
      return false;
    }

    ASSERT_LOG2(' - ok, eliminating constraints, deferring', varIndex);
    ASSERT_LOG2(' - eliminating A <= B, B !& C');

    let indexA = varIndex === left ? right : left;

    ml_eliminate(ml, nandOffset, SIZEOF_VV);
    ml_eliminate(ml, lteOffset, SIZEOF_VV);

    ASSERT_LOG2(' - A is a leaf constraint, defer it', varIndex);

    solveStack.push((domains, force) => {
      ASSERT_LOG2(' - nand + lte;', indexA, '!&', varIndex, '  ->  ', domain__debug(domains[indexA]), '!=', domain__debug(domains[varIndex]));
      ASSERT_LOG2(' - nand + lte;', varIndex, '<=', indexB, '  ->  ', domain__debug(domains[varIndex]), '<=', domain__debug(domains[indexB]));
      let vA = force(indexA);
      let vB = force(indexB);
      // if vA is non-zero then varIndex must be zero, otherwise it must be lte B
      domains[varIndex] = domain_removeGtUnsafe(domains[varIndex], vA ? 0 : vB);
    });

    // we eliminated both constraints so all vars involved decount
    bounty_markVar(bounty, indexA);
    bounty_markVar(bounty, indexB);
    bounty_markVar(bounty, varIndex);
    somethingChanged();
    return true;
  }

  function trickNandIsall(indexX, indexY, nandOffset) {
    // given is the nand offset. find the isall offset

    ASSERT_LOG2('trickNandIsall; X !& B, X = all?(C D)   ->   nall(B C D)');

    for (let i = 0; i < BOUNTY_MAX_OFFSETS_TO_TRACK; ++i) {
      let offset = bounty_getOffset(bounty, indexX, i);
      if (!offset) break;

      let op = ml_dec8(ml, offset);
      if (op === ML_ISALL) {
        return trickNandIsall1(indexX, indexY, nandOffset, offset);
      } else if (op === ML_ISALL2) {
        return trickNandIsall2(indexX, indexY, nandOffset, offset);
      }
    }
    ASSERT_LOG2(' - none of the tracked offsets was an isall, bailing');
    return false;
  }
  function trickNandIsall1(indexX, indexY, nandOffset, isallOffset) {
    // morph the nand to a nall on Y and the args of the isall. keep the isall, remove the nand

    ASSERT_LOG2(' - trickNandIsall1', indexX, indexY, nandOffset, isallOffset);

    let count = ml_dec16(ml, isallOffset + 1);
    let indexR = ml_dec16(ml, isallOffset + SIZEOF_COUNT + count * 2);
    if (indexR !== indexX) {
      ASSERT_LOG2(' - isall mismatch; indexR != indexX, bailing');
      return false;
    }

    // the nall wont fit in the nand and we want to keep the isall, so we need more space
    let recycleOffset = ml_getRecycleOffset(ml, 0, SIZEOF_COUNT + 6);
    if (recycleOffset === undefined) {
      ASSERT_LOG2(' - no free spot to compile this so skip it until we can morph');
      return false;
    }
    let recycleSize = ml_getOpSizeSlow(ml, recycleOffset);

    ASSERT_LOG2(' - okay! R=X and we were able to recycle enough space. lets morph');

    // note: the isall args remain the same. we only have to update the op (-> nall), count (-> +1), and R (-> Y)
    // we must also sort the args afterwards

    ml_enc8(ml, recycleOffset, ML_NALL);
    ml_enc16(ml, recycleOffset + 1, count + 1);
    // copy the isall args. also mark them
    for (let i = 0; i < count; ++i) {
      let index = ml_dec16(ml, isallOffset + SIZEOF_COUNT + i * 2);
      ml_enc16(ml, recycleOffset + SIZEOF_COUNT + i * 2, index);
      bounty_markVar(bounty, index);
    }
    ml_enc16(ml, recycleOffset + SIZEOF_COUNT + count * 2, indexY);
    ml_heapSort16bitInline(ml, recycleOffset + SIZEOF_COUNT, count + 1);
    let opsize = SIZEOF_COUNT + count * 2 + 2;
    let skipSize = recycleSize - opsize;
    if (skipSize) ml_skip(ml, recycleOffset + opsize, skipSize);
    ASSERT(ml_validateSkeleton(ml, 'check isall1 to nall transform'));

    ml_eliminate(ml, nandOffset, SIZEOF_VV);

    // isall args are already marked. now mark the nand args too.
    bounty_markVar(bounty, indexX);
    bounty_markVar(bounty, indexY);
    somethingChanged();

    return true;
  }
  function trickNandIsall2(indexX, indexY, nandOffset, isallOffset) {
    // combine nand and isall. morph the isall to a nall of all args except X. remove the nand

    ASSERT_LOG2(' - trickNandIsall2', indexX, indexY, nandOffset, isallOffset);

    let indexR = ml_dec16(ml, isallOffset + 5);
    if (indexR !== indexX) {
      ASSERT_LOG2(' - isall mismatch; indexR != indexX, bailing');
      return false;
    }

    // isall2 has 3 spots (sizeof=7). the nall requires a sizeof_count for len=3 (sizeof=9). we'll need to recycle
    let recycleOffset = ml_getRecycleOffset(ml, 0, SIZEOF_COUNT + 6);
    if (recycleOffset === undefined) {
      ASSERT_LOG2(' - no free spot to compile this so skip it until we can morph');
      return false;
    }

    let recycleSize = ml_getOpSizeSlow(ml, recycleOffset);

    let indexA = ml_dec16(ml, isallOffset + 1);
    let indexB = ml_dec16(ml, isallOffset + 3);

    ASSERT(ml_validateSkeleton(ml, 'double check...'));
    ml_enc8(ml, recycleOffset, ML_NALL);
    ml_enc16(ml, recycleOffset + 1, 3);
    ml_enc16(ml, recycleOffset + 3, indexY);
    ml_enc16(ml, recycleOffset + 5, indexA);
    ml_enc16(ml, recycleOffset + 7, indexB);
    ml_heapSort16bitInline(ml, recycleOffset + SIZEOF_COUNT, 3);
    let opsize = SIZEOF_COUNT + 3 * 2;
    let skipSize = recycleSize - opsize;
    if (skipSize) ml_skip(ml, recycleOffset + opsize, skipSize);
    ASSERT(ml_validateSkeleton(ml, 'check isall2 to nall transform'));

    ml_eliminate(ml, nandOffset, SIZEOF_VV);

    // mark all affected vars as tainted.
    bounty_markVar(bounty, indexX);
    bounty_markVar(bounty, indexY);
    bounty_markVar(bounty, indexA);
    bounty_markVar(bounty, indexB);
    somethingChanged();

    return true;
  }

  function trickLteLhsIsallShared(indexX, lteOffset) {
    // need to verify that the other lte arg is also an isall arg. it may very well not be.
    // we also don't know which offset is going to be the isall (or isall2), so let's find that first

    let indexY = ml_dec16(ml, lteOffset + 3);
    ASSERT_LOG2('trickLteLhsIsallShared; indexX=', indexX, 'indexY=', indexY, 'lteOffset=', lteOffset);

    for (let i = 0; i < BOUNTY_MAX_OFFSETS_TO_TRACK; ++i) {
      let offset = bounty_getOffset(bounty, indexX, i);
      if (!offset) break;

      let op = ml_dec8(ml, offset);
      if (op === ML_ISALL) {
        return _trickLteLhsIsallSharedIsall1(indexX, indexY, lteOffset, offset);
      }
      if (op === ML_ISALL2) {
        return _trickLteLhsIsallSharedIsall2(indexX, indexY, lteOffset, offset);
      }
    }

    return false;
  }
  function _trickLteLhsIsallSharedIsall1(indexX, indexY, lteOffset, isallOffset) {
    ASSERT_LOG2(' - _trickLteLhsIsallSharedIsall1; indexX=', indexX, 'indexY=', indexY, 'lteOffset=', lteOffset, 'isallOffset=', isallOffset);

    let count = ml_dec16(ml, isallOffset + 1);
    let indexR = ml_dec16(ml, isallOffset + SIZEOF_COUNT + count * 2);

    if (indexR !== indexX) {
      ASSERT_LOG2(' - indexX was not indexR, bailing');
      return false;
    }

    // search for indexY in the args of the isall

    let found = false;
    for (let i = 0; i < count; ++i) {
      let index = ml_dec16(ml, isallOffset + SIZEOF_COUNT + i * 2);
      if (index === indexY) {
        found = true;
        break;
      }
    }
    if (!found) {
      ASSERT_LOG2(' - indexY was not part of the isall, bailing');
      return false;
    }

    ASSERT_LOG2(' - Confirmed `A!&B, A=all?(A C)`, eliminating the nand');

    // ok, just eliminate the nand. it is subsumed by the isall

    ml_eliminate(ml, lteOffset, SIZEOF_VV);
    bounty_markVar(bounty, indexX);
    bounty_markVar(bounty, indexY);
    somethingChanged();

    return true;
  }

  function _trickLteLhsIsallSharedIsall2(indexX, indexY, lteOffset, isallOffset) {
    ASSERT_LOG2(' - _trickLteLhsIsallSharedIsall2; indexX=', indexX, 'indexY=', indexY, 'lteOffset=', lteOffset, 'isallOffset=', isallOffset);

    let indexR = ml_dec16(ml, isallOffset + 5);

    if (indexR !== indexX) {
      ASSERT_LOG2(' - indexX was not indexR, bailing');
      return false;
    }

    // search for indexY in the args of the isall

    let indexA = ml_dec16(ml, isallOffset + 1);
    let indexB = ml_dec16(ml, isallOffset + 3);

    if (indexA !== indexY && indexB !== indexY) {
      ASSERT_LOG2(' - indexY was not an isall arg, bailing');
      return false;
    }

    // ok, just eliminate the nand. it is subsumed by the isall

    ASSERT_LOG2(' - Confirmed `A!&B, A=all?(A C)`, eliminating the nand');

    ml_eliminate(ml, lteOffset, SIZEOF_VV);
    bounty_markVar(bounty, indexX);
    bounty_markVar(bounty, indexY);
    somethingChanged();

    return true;
  }

  function trickNeqElimination(indexX) {
    // X is used multiple times and only with exactly one neq
    // and multiple lte's, or's, nand's.
    // multiple neq's should be eliminated elsewhere
    // lte's are rewritten to NAND or OR, depending where X is
    // or's are rewritten to LTE's
    // nand's are rewritten to LTE's
    // X is considered a leaf var. rewrites use the other NEQ arg Y

    // A <= X, X != Y    ->    A !& Y
    // X <= A, X != Y    ->    A | Y
    // X | A, X != Y     ->    Y <= A
    // X !& A, X != Y     ->    A <= A
    // (any number of ops work the same on a neq, you just invert them)

    // first we need to validate. we can only have one neq

    ASSERT_LOG2('trickNeqElimination', indexX);

    if (!domain_isBool(domains[getFinalIndex(indexX)])) {
      ASSERT_LOG2(' - X is non-bool, bailing');
      return false;
    }

    // we need the offsets to eliminate them and to get the "other" var index for each
    let indexY;
    let neqOffset;
    let lhsOffsets = [];
    let rhsOffsets = [];
    let orOffsets = [];
    let nandOffsets = [];

    let seenNeq = false;
    for (let i = 0; i < BOUNTY_MAX_OFFSETS_TO_TRACK; ++i) {
      let offset = bounty_getOffset(bounty, indexX, i);
      if (!offset) break;

      let indexA = ml_dec16(ml, offset + 1);
      let indexB = ml_dec16(ml, offset + 3);

      let op = ml_dec8(ml, offset);
      if (op === ML_VV_LTE) {
        let indexT;
        if (indexA === indexX) {
          lhsOffsets.push(offset);
          indexT = indexB;
        } else if (indexB === indexX) {
          rhsOffsets.push(offset);
          indexT = indexA;
        } else {
          ASSERT_LOG2(' - lte without indexX (??), bailing');
          return false;
        }

        if (!domain_isBool(domains[getFinalIndex(indexT)])) {
          ASSERT_LOG2(' - found a non-bool lte arg, bailing');
          return false;
        }
      } else if (op === ML_VV_NEQ) {
        if (seenNeq) {
          ASSERT_LOG2(' - found second neq, bailing');
          return false;
        }

        if (indexA === indexX) {
          indexY = indexB;
        } else if (indexB === indexX) {
          indexY = indexA;
        } else {
          return false;
        }

        seenNeq = true;
        neqOffset = offset;
      } else if (op === ML_VV_OR) {
        let indexT;
        if (indexA === indexX) {
          orOffsets.push(offset);
          indexT = indexB;
        } else if (indexB === indexX) {
          orOffsets.push(offset);
          indexT = indexA;
        } else {
          ASSERT_LOG2(' - lte without indexX (??), bailing');
          return false;
        }

        if (!domain_isBool(domains[getFinalIndex(indexT)])) {
          ASSERT_LOG2(' - found a non-bool or arg, bailing');
          return false;
        }
      } else if (op === ML_VV_NAND) {
        let indexT;
        if (indexA === indexX) {
          nandOffsets.push(offset);
          indexT = indexB;
        } else if (indexB === indexX) {
          nandOffsets.push(offset);
          indexT = indexA;
        } else {
          ASSERT_LOG2(' - lte without indexX (??), bailing');
          return false;
        }

        if (!domain_isBool(domains[getFinalIndex(indexT)])) {
          ASSERT_LOG2(' - found a non-bool or arg, bailing');
          return false;
        }
      } else {
        ASSERT_LOG2(' - found an op that wasnt neq or lte, bailing');
        return false;
      }
    }

    ASSERT_LOG2(' - collection complete; indexY =', indexY, ', neq offset =', neqOffset, ', lhs offsets:', lhsOffsets, ', rhs offsets:', rhsOffsets, ', or offsets:', orOffsets, ', nand offsets:', nandOffsets);

    if (!seenNeq) {
      ASSERT_LOG2(' - did not find neq, bailing');
      return false;
    }

    // okay. pattern matches. do the rewrite

    ASSERT_LOG2(' - pattern confirmed, morphing ltes, removing neq');
    ASSERT_LOG2(' - A <= X, X != Y    ->    A !& Y');
    ASSERT_LOG2(' - X <= A, X != Y    ->    A | Y');
    ASSERT_LOG2(' - X | A, X != Y     ->    Y <= A');

    for (let i = 0, len = lhsOffsets.length; i < len; ++i) {
      // X <= A, X != Y    ->    A | Y
      let offset = lhsOffsets[i];
      let index = ml_dec16(ml, offset + 1);
      if (index === indexX) index = ml_dec16(ml, offset + 3);
      bounty_markVar(bounty, index);
      ml_vv2vv(ml, offset, ML_VV_OR, index, indexY);
    }

    ASSERT(ml_validateSkeleton(ml, 'check after lhs offsets'));

    for (let i = 0, len = rhsOffsets.length; i < len; ++i) {
      // X <= A, X != Y    ->    A | Y
      let offset = rhsOffsets[i];
      let index = ml_dec16(ml, offset + 1);
      if (index === indexX) index = ml_dec16(ml, offset + 3);
      bounty_markVar(bounty, index);
      ml_vv2vv(ml, offset, ML_VV_NAND, index, indexY);
    }

    ASSERT(ml_validateSkeleton(ml, 'check after rhs offsets'));

    for (let i = 0, len = orOffsets.length; i < len; ++i) {
      // X | A, X != Y    ->    Y <= A
      let offset = orOffsets[i];
      let index = ml_dec16(ml, offset + 1);
      if (index === indexX) index = ml_dec16(ml, offset + 3);
      bounty_markVar(bounty, index);
      ml_vv2vv(ml, offset, ML_VV_LTE, indexY, index);
    }

    ASSERT(ml_validateSkeleton(ml, 'check after or offsets'));

    for (let i = 0, len = nandOffsets.length; i < len; ++i) {
      // X !& A, X != Y    ->    A <= Y
      let offset = nandOffsets[i];
      let index = ml_dec16(ml, offset + 1);
      if (index === indexX) index = ml_dec16(ml, offset + 3);
      bounty_markVar(bounty, index);
      ml_vv2vv(ml, offset, ML_VV_LTE, index, indexY);
    }

    ASSERT(ml_validateSkeleton(ml, 'check after or offsets'));

    ml_eliminate(ml, neqOffset, SIZEOF_VV);

    ASSERT(ml_validateSkeleton(ml, 'make sure the morphs went okay'));

    ASSERT_LOG2(' - X is a leaf constraint, defer it', indexX);
    solveStack.push((domains, force) => {
      ASSERT_LOG2(' - neq + lte + lte...;', indexX, '!=', indexY, '  ->  ', domain__debug(domains[indexX]), '!=', domain__debug(domains[indexY]));

      domains[indexX] = domain_removeValue(domains[indexX], force(indexY));
    });

    bounty_markVar(bounty, indexX);
    bounty_markVar(bounty, indexY);
    somethingChanged();
    return true;
  }

  function trickNandOnly(indexX) {
    ASSERT_LOG2('trickNandOnly', indexX);

    let offsets = []; // to eliminate
    let indexes = []; // to mark and to defer solve
    for (let i = 0; i < BOUNTY_MAX_OFFSETS_TO_TRACK; ++i) {
      let offset = bounty_getOffset(bounty, indexX, i);
      if (!offset) break;

      let opCode = ml_dec8(ml, offset);
      if (opCode !== ML_VV_NAND) {
        ASSERT_LOG2(' - opcode wasnt nand but was expecting only nands, bailing');
        return false;
      }

      let indexA = ml_dec16(ml, offset + 1);
      let indexB = ml_dec16(ml, offset + 3);

      let indexY = indexA;
      if (indexY === indexX) {
        indexY = indexB;
      } else if (!indexB !== indexX) {
        ASSERT_LOG2(' - a nand did not have the proper args (??), bailing');
        return false;
      }

      offsets.push(offset);
      indexes.push(indexY);
    }

    ASSERT_LOG2(' - collected offsets and vars:', offsets, indexes);

    ASSERT_LOG2('   - B is a leaf var');
    solveStack.push((domains, force) => {
      ASSERT_LOG2(' - only nands;', indexes);

      let X = domains[indexX];
      if (!domain_isZero(X) && !domain_hasNoZero(X)) {
        for (let i = 0; i < indexes.length; ++i) {
          if (force(indexes[i]) > 0) {
            domains[indexX] = domain_removeGtUnsafe(X, 0);
            break;
          }
        }
      }
    });
    ASSERT(!void (solveStack[solveStack.length - 1]._target = indexX));
    ASSERT(!void (solveStack[solveStack.length - 1]._meta = 'nands only'));

    ASSERT_LOG2(' - now remove the nands', offsets);

    for (let i = 0; i < offsets.length; ++i) {
      let offset = offsets[i];
      let indexY = indexes[i];

      ml_eliminate(ml, offset, SIZEOF_VV);
      bounty_markVar(bounty, indexY);
    }

    ASSERT(ml_validateSkeleton(ml, 'make sure the elimination went okay'));

    bounty_markVar(bounty, indexX);
    somethingChanged();

    return true;
  }

  function trickOrLteLhsNands(indexX) {
    ASSERT_LOG2('trickOrLteLhsNands', indexX);
    // A !& X, X <= B, X | C    ->     B | C, A <= C

    let lteOffset;
    let orOffset;
    let nandOffsets = [];

    let indexesA = [];
    let indexB;
    let indexC;

    for (let i = 0; i < BOUNTY_MAX_OFFSETS_TO_TRACK; ++i) {
      let offset = bounty_getOffset(bounty, indexX, i);
      if (!offset) break;

      let indexL = ml_dec16(ml, offset + 1);
      let indexR = ml_dec16(ml, offset + 3);

      let indexY = indexL;
      if (indexL === indexX) {
        indexY = indexR;
      } else if (indexR !== indexX) {
        ASSERT_LOG2(' - op did not have our target var on either side, bailing');
        return false;
      }

      let opCode = ml_dec8(ml, offset);
      if (opCode === ML_VV_NAND) {
        nandOffsets.push(offset);
        indexesA.push(indexY);
      } else if (opCode === ML_VV_OR) {
        if (orOffset) {
          ASSERT_LOG2(' - trick only supported with one OR, bailing');
          return false;
        }
        orOffset = offset;
        indexB = indexY;
      } else if (opCode === ML_VV_LTE) {
        if (lteOffset) {
          ASSERT_LOG2(' - trick only supported with one LTE, bailing');
          return false;
        }
        if (indexL !== indexX) {
          ASSERT_LOG2(' - X must be lhs of LTE, bailing');
          return false;
        }
        lteOffset = offset;
        indexC = indexY;
      }
    }

    ASSERT_LOG2(' - collection complete; or offset:', orOffset, ', indexB:', indexB, ', lte offset:', lteOffset, ', indexC:', indexC, ', nand offsets:', nandOffsets, ', indexesA:', indexesA);
    ASSERT_LOG2(' - A !& X, X <= B, X | C    ->     B | C, A <= C');
    ASSERT_LOG2(' - A !& X, D !& X, X <= B, X | C    ->     B | C, A <= C, D <= C');
    // the A <= C for all nand args (all <= C)

    ml_vv2vv(ml, lteOffset, ML_VV_OR, indexB, indexC);
    ml_eliminate(ml, orOffset, SIZEOF_VV);
    for (let i = 0, len = indexesA.length; i < len; ++i) {
      let indexA = indexesA[i];
      ml_vv2vv(ml, nandOffsets[i], ML_VV_LTE, indexA, indexC);
      bounty_markVar(bounty, indexA);
    }

    ASSERT_LOG2('   - X is a leaf var', indexX);
    solveStack.push((domains, force) => {
      ASSERT_LOG2(' - or+lte+nands;', indexX);

      let X = domains[indexX];
      if (force(indexB) === 0) { // A<=B so if B is 0, A must also be 0
        domains[indexX] = domain_removeGtUnsafe(X, 0);
      } else if (force(indexC) === 0) { // X|C so if C is 0, X must be non-zero
        domains[indexX] = domain_removeValue(X, 0);
      } else {
        // if any indexA is set, X must be zero
        for (let i = 0, len = indexesA.length; i < len; ++i) {
          if (force(indexesA[i]) > 0) {
            domains[indexX] = domain_removeGtUnsafe(X, 0);
            break;
          }
        }
      }
    });
    ASSERT(!void (solveStack[solveStack.length - 1]._target = indexX));
    ASSERT(!void (solveStack[solveStack.length - 1]._meta = 'or+lte+nands'));

    bounty_markVar(bounty, indexB);
    bounty_markVar(bounty, indexC);
    bounty_markVar(bounty, indexX);
    somethingChanged();
    return true;
  }

  function trickOrNandLteBoth(indexX) {
    ASSERT_LOG2('trickOrNandLteBoth', indexX);
    // A <= X, B | X, C !& X, X <= D     ->     A !& C, B | D, A <= D, C <= B
    // if we can model `A !& C, A <= D` in one constraint then we should do so but I couldn't find one
    // (when more lte's are added, that's the pattern we add for each)

    // we should have; lteRhs, lteLhs, nand, or
    let lteLhsOffset;
    let lteRhsOffset;
    let orOffset;
    let nandOffset;

    let indexA;
    let indexB;
    let indexC;
    let indexD;

    for (let i = 0; i < BOUNTY_MAX_OFFSETS_TO_TRACK; ++i) {
      let offset = bounty_getOffset(bounty, indexX, i);
      if (!offset) break;

      let indexL = ml_dec16(ml, offset + 1);
      let indexR = ml_dec16(ml, offset + 3);

      let indexY = indexL;
      if (indexL === indexX) {
        indexY = indexR;
      } else if (indexR !== indexX) {
        ASSERT_LOG2(' - op did not have our target var on either side, bailing');
        return false;
      }

      let opCode = ml_dec8(ml, offset);
      if (opCode === ML_VV_NAND) {
        if (nandOffset) {
          ASSERT_LOG2(' - trick only supported with one NAND, bailing');
          return false;
        }
        nandOffset = offset;
        indexC = indexY;
      } else if (opCode === ML_VV_OR) {
        if (orOffset) {
          ASSERT_LOG2(' - trick only supported with one OR, bailing');
          return false;
        }
        orOffset = offset;
        indexB = indexY;
      } else if (opCode === ML_VV_LTE) {
        if (indexL === indexX) { // lte_lhs
          if (lteLhsOffset) {
            ASSERT_LOG2(' - trick only supported with one LTE_lhs, bailing');
            return false;
          }
          lteLhsOffset = offset;
          indexD = indexY;
        } else if (indexR === indexX) { // lte_rhs
          if (lteRhsOffset) {
            ASSERT_LOG2(' - trick only supported with one LTE_rhs, bailing');
            return false;
          }
          lteRhsOffset = offset;
          indexA = indexY;
        } else {
          ASSERT_LOG2(' - X not an arg of the lte, bailing');
          return false;
        }
      }
    }

    ASSERT_LOG2(' - collection complete; or offsets:', lteLhsOffset, lteRhsOffset, orOffset, nandOffset, ', indexes:', indexA, indexB, indexC, indexD);
    ASSERT_LOG2(' - A <= X, B | X, C !& X, X <= D     ->     A !& C, B | D, A <= D, C <= B');

    ml_vv2vv(ml, lteLhsOffset, ML_VV_NAND, indexA, indexC);
    ml_vv2vv(ml, lteRhsOffset, ML_VV_OR, indexB, indexD);
    ml_vv2vv(ml, orOffset, ML_VV_LTE, indexA, indexD);
    ml_vv2vv(ml, nandOffset, ML_VV_LTE, indexC, indexD);

    ASSERT_LOG2('   - X is a leaf var', indexX);
    solveStack.push((domains, force) => {
      ASSERT_LOG2(' - or+nand+lte_lhs+lte_rhs;', indexX);

      let X = domains[indexX];
      if (force(indexA) === 1) { // A<=X so if A is 1, X must also be 1
        domains[indexX] = domain_removeValue(X, 0);
      } else if (force(indexB) === 0) { // X|B so if B is 0, X must be non-zero
        domains[indexX] = domain_removeValue(X, 0);
      } else if (force(indexC) > 0) { // if indexA is set, X must be zero
        domains[indexX] = domain_removeGtUnsafe(X, 0);
      } else if (force(indexD) === 0) { // X<=D, if indexD is 0, X must be zero
        domains[indexX] = domain_removeGtUnsafe(X, 0);
      }
    });
    ASSERT(!void (solveStack[solveStack.length - 1]._target = indexX));
    ASSERT(!void (solveStack[solveStack.length - 1]._meta = 'or+nand+lte_lhs+lte_rhs'));

    bounty_markVar(bounty, indexA);
    bounty_markVar(bounty, indexB);
    bounty_markVar(bounty, indexC);
    bounty_markVar(bounty, indexD);
    bounty_markVar(bounty, indexX);
    somethingChanged();
    return true;
  }

  function cutLoop() {
    ASSERT_LOG2('\n - inner cutLoop');
    pc = 0;
    while (pc < ml.length && !emptyDomain) {
      let pcStart = pc;
      let op = ml[pc];
      ASSERT_LOG2(' -- CU pc=' + pc + ', op: ' + ml__debug(ml, pc, 1, domains, vars));
      switch (op) {
        case ML_VV_EQ:
          return ml_throw(ml, pc, 'eqs should be aliased and eliminated');

        case ML_VV_NEQ:
          cutNeq();
          break;

        case ML_VV_LT:
          cutLt();
          break;

        case ML_VV_LTE:
          cutLte();
          break;

        case ML_V8_EQ:
        case ML_88_EQ:
        case ML_V8_NEQ:
        case ML_88_NEQ:
        case ML_V8_LT:
        case ML_8V_LT:
        case ML_88_LT:
        case ML_V8_LTE:
        case ML_8V_LTE:
        case ML_88_LTE:
          return ml_throw(ml, pc, 'constraints with <= 1 var should be eliminated');

        case ML_NALL:
          cutNall();
          break;

        case ML_DISTINCT:
          ASSERT_LOG2('(todo) d', pc);
          let dlen = ml_dec16(ml, pc + 1);
          pc += SIZEOF_COUNT + dlen * 2;
          break;

        case ML_ISALL:
          cutIsAll();
          break;

        case ML_ISNALL:
          cutIsNall();
          break;

        case ML_ISALL2:
          cutIsAll2();
          break;

        case ML_ISNONE:
          ASSERT_LOG2('(todo) none', pc);
          let nlen = ml_dec16(ml, pc + 1);
          pc += SIZEOF_COUNT + nlen * 2 + 2;
          break;

        case ML_PLUS:
          cutPlus(ml, pc);
          break;
        case ML_MINUS:
          pc += SIZEOF_VVV;
          break;
        case ML_MUL:
          pc += SIZEOF_VVV;
          break;
        case ML_DIV:
          pc += SIZEOF_VVV;
          break;

        case ML_VVV_ISEQ:
          cutIsEq(ml, pc, SIZEOF_VVV, 2);
          break;
        case ML_VVV_ISNEQ:
          cutIsNeq(ml, pc, SIZEOF_VVV, 2);
          break;
        case ML_VVV_ISLT:
          cutIsLt(ml, pc, SIZEOF_VVV, 2, 2);
          break;
        case ML_VVV_ISLTE:
          cutIsLte(ml, pc, SIZEOF_VVV, 2, 2);
          break;

        case ML_V8V_ISEQ:
          cutIsEq(ml, pc, SIZEOF_V8V, 1);
          break;
        case ML_V8V_ISNEQ:
          cutIsNeq(ml, pc, SIZEOF_V8V, 1);
          break;
        case ML_V8V_ISLT:
          cutIsLt(ml, pc, SIZEOF_V8V, 2, 1);
          break;
        case ML_V8V_ISLTE:
          cutIsLte(ml, pc, SIZEOF_V8V, 2, 1);
          break;

        case ML_8VV_ISLT:
          cutIsLt(ml, pc, SIZEOF_8VV, 1, 2);
          break;
        case ML_8VV_ISLTE:
          cutIsLte(ml, pc, SIZEOF_8VV, 1, 2);
          break;

        case ML_VV8_ISEQ:
        case ML_VV8_ISNEQ:
        case ML_VV8_ISLT:
        case ML_VV8_ISLTE:
          return ml_throw(ml, pc, 'reifiers with constant R should have been morphed');

        case ML_88V_ISEQ:
        case ML_88V_ISNEQ:
        case ML_88V_ISLT:
        case ML_88V_ISLTE:
        case ML_V88_ISEQ:
        case ML_V88_ISNEQ:
        case ML_V88_ISLT:
        case ML_V88_ISLTE:
        case ML_8V8_ISLT:
        case ML_8V8_ISLTE:
        case ML_888_ISEQ:
        case ML_888_ISNEQ:
        case ML_888_ISLT:
        case ML_888_ISLTE:
          return ml_throw(ml, pc, 'constraints with <= 1 var should be eliminated');

        case ML_8V_SUM:
          cutSum(ml, pc);
          break;

        case ML_PRODUCT:
          ASSERT_LOG2('(todo) p', pc);
          let plen = ml_dec16(ml, pc + 1);
          pc += SIZEOF_COUNT + plen * 2 + 2;
          break;

        case ML_VV_AND:
          return ml_throw(ml, pc, 'ands should be solved and eliminated');
        case ML_VV_OR:
          cutOr();
          break;
        case ML_VV_XOR:
          cutXor();
          break;
        case ML_VV_NAND:
          cutNand();
          break;
        case ML_VV_XNOR:
          cutXnor();
          break;

        case ML_START:
          if (pc !== 0) return ml_throw(ml, pc, ' ! compiler problem @', pcStart);
          ++pc;
          break;

        case ML_STOP:
          return;

        case ML_DEBUG:
          pc += SIZEOF_V;
          break;

        case ML_JMP:
          pc += SIZEOF_V + ml_dec16(ml, pc + 1);
          break;
        case ML_JMP32:
          pc += SIZEOF_W + ml_dec32(ml, pc + 1);
          break;

        case ML_NOOP:
          ++pc;
          break;
        case ML_NOOP2:
          pc += 2;
          break;
        case ML_NOOP3:
          pc += 3;
          break;
        case ML_NOOP4:
          pc += 4;
          break;

        default:
          //console.error('(cut) unknown op', pc,' at', pc,'ctrl+c now or log will fill up');
          //while (true) console.log('beep');
          ml_throw(ml, pc, '(cut) unknown op', pc);
      }
    }
    if (emptyDomain) {
      ASSERT_LOG2('Ended up with an empty domain');
      return;
    }
    ASSERT_LOG2('the implicit end; ml desynced');
    THROW('ML OOB');
  }
}

// BODY_STOP

export {
  cutter,
};
