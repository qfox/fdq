import {
  NO_CHANGES,
  REJECTED,

  ASSERT_DOMAIN_EMPTY_CHECK,
} from '../helpers';

import {
  domain_max,
  domain_min,
} from '../domain';

import {
  fdvar_isRejected,
  fdvar_removeGteInline,
  fdvar_removeLteInline,
  fdvar_upperBound,
} from '../fdvar';

// BODY_START

/**
 * @param {Fdvar} fdvar1
 * @param {Fdvar} fdvar2
 * @returns {number}
 */
function propagator_lteStepBare(fdvar1, fdvar2) {
  ASSERT_DOMAIN_EMPTY_CHECK(fdvar1.dom);
  ASSERT_DOMAIN_EMPTY_CHECK(fdvar2.dom);

  let lo1 = domain_min(fdvar1.dom);
  let hi1 = fdvar_upperBound(fdvar1);
  let lo2 = domain_min(fdvar2.dom);
  let hi2 = fdvar_upperBound(fdvar2);

  // every number in v1 can only be smaller than or equal to the biggest
  // value in v2. bigger values will never satisfy lt so prune them.
  if (hi1 > hi2) {
    var leftChanged = fdvar_removeGteInline(fdvar1, hi2 + 1);
    if (fdvar_isRejected(fdvar1)) {
      leftChanged = REJECTED;
    }
  }

  // likewise; numbers in v2 that are smaller than or equal to the
  // smallest value of v1 can never satisfy lt so prune them as well
  if (lo1 > lo2) {
    var rightChanged = fdvar_removeLteInline(fdvar2, lo1 - 1);
    if (fdvar_isRejected(fdvar2)) {
      rightChanged = REJECTED;
    }
  }

  return leftChanged || rightChanged || NO_CHANGES;
}

/**
 * lte would reject if all elements in the left var are bigger than the
 * right var. And since everything is CSIS, we only have to check the
 * lo bound of left to the high bound of right for that answer.
 * Read-only check
 *
 * @param {Fdvar} fdvar1
 * @param {Fdvar} fdvar2
 * @returns {*}
 */
function propagator_lteStepWouldReject(fdvar1, fdvar2) {
  let dom1 = fdvar1.dom;
  let dom2 = fdvar2.dom;

  ASSERT_DOMAIN_EMPTY_CHECK(dom1);
  ASSERT_DOMAIN_EMPTY_CHECK(dom2);
//    if domain_isRejected dom1 or domain_isRejected dom2
//      return true

  return domain_min(dom1) > domain_max(dom2);
}

/**
 * lte is solved if fdvar1 contains no values that are
 * higher than any numbers in fdvar2. Since domains only
 * shrink we can assume that the lte constraint will not
 * be broken by searching further once this state is seen.
 *
 * @param {Fdvar} fdvar1
 * @param {Fdvar} fdvar2
 * @returns {*}
 */
function propagator_lteSolved(fdvar1, fdvar2) {
  return fdvar_upperBound(fdvar1) <= domain_min(fdvar2.dom);
}

// BODY_STOP

export {
  propagator_lteStepBare,
  propagator_lteStepWouldReject,
  propagator_lteSolved,
};
