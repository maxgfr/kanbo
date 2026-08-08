import { EMPTY_PROJECT, type Project } from '@kanbo/core'

import { KanboError, resolveItem, resolveMember, resolveSprint, resolveStatus } from './resolve.ts'

/**
 * The resolvers, and mostly the case they exist for.
 *
 * Finding the one thing somebody named is the easy half. The half worth testing
 * is what happens when a project contains two of them: the old code took the
 * first match, which made the second column called "Done" permanently
 * unreachable and said nothing about it.
 */
function projectWith(patch: Partial<Project>): Project {
  return { ...EMPTY_PROJECT, ...patch }
}

const status = (id: string, name: string) =>
  ({ id, name, category: 'todo', order: 'a', wipLimit: null, color: null }) as const

describe('resolving a column', () => {
  const project = projectWith({ statuses: [status('s1', 'Backlog'), status('s2', 'Done')] })

  it('does not care about case', () => {
    expect(resolveStatus(project, 'bAcKlOg').id).toBe('s1')
  })

  it('takes an id as readily as a name', () => {
    expect(resolveStatus(project, 's2').id).toBe('s2')
  })

  it('lists what there is when the name is not one of them', () => {
    try {
      resolveStatus(project, 'Shipped')
      expect.unreachable('should have refused')
    } catch (error) {
      expect(error).toBeInstanceOf(KanboError)
      expect((error as KanboError).candidates).toEqual(['Backlog', 'Done'])
    }
  })

  it('refuses to guess between two columns of the same name', () => {
    const ambiguous = projectWith({ statuses: [status('s1', 'Done'), status('s2', 'Done')] })

    try {
      resolveStatus(ambiguous, 'Done')
      expect.unreachable('should have refused')
    } catch (error) {
      expect((error as KanboError).message).toContain('More than one')
      // The useful half of the answer is which two, and how to say which.
      expect((error as KanboError).candidates).toEqual(['s1  Done', 's2  Done'])
    }
  })
})

describe('resolving a person', () => {
  const project = projectWith({
    members: [
      { id: 'm1', name: 'Ada Lovelace', handle: 'ada' },
      { id: 'm2', name: 'Alan Turing', handle: null },
    ],
  })

  it('finds them by name', () => {
    expect(resolveMember(project, 'alan turing').id).toBe('m2')
  })

  it('finds them by the handle their forge spells them with', () => {
    expect(resolveMember(project, '@ada').id).toBe('m1')
    expect(resolveMember(project, 'ada').id).toBe('m1')
  })

  it('says the project has nobody rather than naming nobody', () => {
    expect(() => resolveMember(projectWith({}), 'Ada')).toThrow('no person yet')
  })
})

const iteration = (id: string, name: string, startsAt: string, endsAt: string) =>
  ({ id, name, goal: '', startsAt, endsAt, capacity: null, order: 'a' }) as const

const item = (id: string, ref: string) =>
  ({ ...EMPTY_PROJECT, id, ref }) as unknown as Project['items'][number]

describe('resolving a sprint', () => {
  const now = Date.parse('2026-08-08T12:00:00Z')
  const project = projectWith({
    iterations: [
      iteration('i1', 'Sprint 11', '2026-07-20', '2026-08-02'),
      iteration('i2', 'Sprint 12', '2026-08-03', '2026-08-16'),
    ],
  })

  it('reads "current" the same way the query language does', () => {
    expect(resolveSprint(project, 'current', now).id).toBe('i2')
  })

  it('says no sprint is running rather than inventing one', () => {
    const between = Date.parse('2026-09-30T12:00:00Z')
    expect(() => resolveSprint(project, 'current', between)).toThrow('No sprint is running')
  })

  it('still takes a name', () => {
    expect(resolveSprint(project, 'Sprint 11', now).id).toBe('i1')
  })
})

describe('resolving an item', () => {
  const project = projectWith({ items: [item('x1', 'APL-1'), item('x2', 'APL-2')] })

  it('takes a reference in any case', () => {
    expect(resolveItem(project, 'apl-2').id).toBe('x2')
  })

  it('takes an id, which is what the JSON front-ends have', () => {
    expect(resolveItem(project, 'x1').ref).toBe('APL-1')
  })

  it('does not print the whole board back at someone who mistyped', () => {
    try {
      resolveItem(project, 'APL-99')
      expect.unreachable('should have refused')
    } catch (error) {
      expect((error as KanboError).candidates).toEqual(['References look like APL-1.'])
    }
  })
})
