import {
  __publicField
} from "./chunk-QZ7TP4HQ.mjs";

// src/machine.ts
import {
  createReplaceTracker,
  createScope,
  findTransition,
  getExitEnterStates,
  hasTag,
  INIT_STATE,
  MachineStatus,
  matchesState,
  resolveStateValue
} from "@zag-js/core";
import { subscribe } from "@zag-js/store";
import {
  callAll,
  compact,
  ensure,
  identity,
  isEqual,
  isFunction,
  isString,
  runIfFn,
  toArray,
  warn
} from "@zag-js/utils";
import { bindable } from "./bindable.mjs";
import { createRefs } from "./refs.mjs";
import { mergeMachineProps } from "./merge-machine-props.mjs";
var VanillaMachine = class {
  constructor(machine, userProps = {}) {
    __publicField(this, "machine", machine);
    __publicField(this, "scope");
    __publicField(this, "context");
    __publicField(this, "prop");
    __publicField(this, "state");
    __publicField(this, "refs");
    __publicField(this, "computed");
    __publicField(this, "event", { type: "" });
    __publicField(this, "previousEvent", { type: "" });
    __publicField(this, "effects", /* @__PURE__ */ new Map());
    __publicField(this, "replaceTracker", createReplaceTracker());
    __publicField(this, "transition", null);
    __publicField(this, "cleanups", []);
    __publicField(this, "subscriptions", []);
    __publicField(this, "userPropsRef");
    __publicField(this, "getEvent", () => ({
      ...this.event,
      current: () => this.event,
      previous: () => this.previousEvent
    }));
    __publicField(this, "getState", () => ({
      ...this.state,
      matches: (...values) => values.some((value) => matchesState(this.state.get(), value)),
      hasTag: (tag) => hasTag(this.machine, this.state.get(), tag)
    }));
    __publicField(this, "debug", (...args) => {
      if (this.machine.debug) console.log(...args);
    });
    __publicField(this, "notify", () => {
      this.publish();
    });
    __publicField(this, "send", (event) => {
      if (this.status !== MachineStatus.Started) return;
      const key = event?.replaces;
      const token = key ? this.replaceTracker.claim(key) : void 0;
      queueMicrotask(() => {
        if (!event) return;
        if (key && token && this.replaceTracker.isReplaced(key, token)) return;
        this.previousEvent = this.event;
        this.event = event;
        this.debug("send", event);
        let currentState = this.state.get();
        const eventType = event.type;
        const { transitions, source } = findTransition(this.machine, currentState, eventType);
        const transition = this.choose(transitions);
        if (!transition) return;
        this.transition = transition;
        const target = resolveStateValue(this.machine, transition.target ?? currentState, source);
        this.debug("transition", transition);
        const changed = target !== currentState;
        if (changed) {
          this.state.set(target);
        } else if (transition.reenter) {
          this.state.invoke(currentState, currentState);
        } else {
          this.action(transition.actions);
        }
      });
    });
    __publicField(this, "action", (keys) => {
      const strs = isFunction(keys) ? keys(this.getParams()) : keys;
      if (!strs) return;
      const fns = strs.map((s) => {
        const fn = this.machine.implementations?.actions?.[s];
        if (!fn) warn(`[zag-js] No implementation found for action "${JSON.stringify(s)}"`);
        return fn;
      });
      for (const fn of fns) {
        fn?.(this.getParams());
      }
    });
    __publicField(this, "guard", (str) => {
      if (isFunction(str)) return str(this.getParams());
      const fn = this.machine.implementations?.guards?.[str];
      if (!fn) warn(`[zag-js] No implementation found for guard "${JSON.stringify(str)}"`);
      return fn?.(this.getParams());
    });
    __publicField(this, "effect", (keys) => {
      const strs = isFunction(keys) ? keys(this.getParams()) : keys;
      if (!strs) return;
      const fns = strs.map((s) => {
        const fn = this.machine.implementations?.effects?.[s];
        if (!fn) warn(`[zag-js] No implementation found for effect "${JSON.stringify(s)}"`);
        return fn;
      });
      const cleanups = [];
      for (const fn of fns) {
        const cleanup = fn?.(this.getParams());
        if (cleanup) cleanups.push(cleanup);
      }
      return () => cleanups.forEach((fn) => fn?.());
    });
    __publicField(this, "choose", (transitions) => {
      return toArray(transitions).find((t) => {
        let result = !t.guard;
        if (isString(t.guard)) result = !!this.guard(t.guard);
        else if (isFunction(t.guard)) result = t.guard(this.getParams());
        return result;
      });
    });
    __publicField(this, "subscribe", (fn) => {
      this.subscriptions.push(fn);
      return () => {
        const index = this.subscriptions.indexOf(fn);
        if (index > -1) this.subscriptions.splice(index, 1);
      };
    });
    __publicField(this, "status", MachineStatus.NotStarted);
    __publicField(this, "publish", () => {
      this.callTrackers();
      this.subscriptions.forEach((fn) => fn(this.service));
    });
    __publicField(this, "trackers", []);
    __publicField(this, "setupTrackers", () => {
      this.machine.watch?.(this.getParams());
    });
    __publicField(this, "callTrackers", () => {
      this.trackers.forEach(({ deps, fn }) => {
        const next = deps.map((dep) => dep());
        if (!isEqual(fn.prev, next)) {
          fn();
          fn.prev = next;
        }
      });
    });
    __publicField(this, "getParams", () => ({
      state: this.getState(),
      context: this.context,
      event: this.getEvent(),
      prop: this.prop,
      send: this.send,
      action: this.action,
      guard: this.guard,
      track: (deps, fn) => {
        fn.prev = deps.map((dep) => dep());
        this.trackers.push({ deps, fn });
      },
      refs: this.refs,
      computed: this.computed,
      flush: identity,
      scope: this.scope,
      choose: this.choose
    }));
    this.userPropsRef = { current: userProps };
    const { id, ids, getRootNode } = runIfFn(userProps);
    this.scope = createScope({ id, ids, getRootNode });
    const prop = (key) => {
      const __props = runIfFn(this.userPropsRef.current);
      const props = machine.props?.({ props: compact(__props), scope: this.scope }) ?? __props;
      return props[key];
    };
    this.prop = prop;
    const context = machine.context?.({
      prop,
      bindable,
      scope: this.scope,
      flush(fn) {
        queueMicrotask(fn);
      },
      getContext() {
        return ctx;
      },
      getComputed() {
        return computed;
      },
      getRefs() {
        return refs;
      },
      getEvent: this.getEvent.bind(this)
    });
    if (context) {
      Object.values(context).forEach((item) => {
        const unsub = subscribe(item.ref, () => this.notify());
        this.cleanups.push(unsub);
      });
    }
    const ctx = {
      get(key) {
        return context?.[key].get();
      },
      set(key, value) {
        context?.[key].set(value);
      },
      initial(key) {
        return context?.[key].initial;
      },
      hash(key) {
        const current = context?.[key].get();
        return context?.[key].hash(current);
      }
    };
    this.context = ctx;
    const computed = (key) => {
      ensure(machine.computed, () => `[zag-js] No computed object found on machine`);
      return machine.computed[key]({
        context: ctx,
        event: this.getEvent(),
        prop,
        refs: this.refs,
        scope: this.scope,
        computed
      });
    };
    this.computed = computed;
    const refs = createRefs(machine.refs?.({ prop, context: ctx }) ?? {});
    this.refs = refs;
    const state = bindable(() => ({
      defaultValue: resolveStateValue(machine, machine.initialState({ prop })),
      onChange: (nextState, prevState) => {
        const { exiting, entering } = getExitEnterStates(this.machine, prevState, nextState, this.transition?.reenter);
        exiting.forEach((item) => {
          const exitEffects = this.effects.get(item.path);
          exitEffects?.();
          this.effects.delete(item.path);
        });
        exiting.forEach((item) => {
          this.action(item.state?.exit);
        });
        this.action(this.transition?.actions);
        entering.forEach((item) => {
          const cleanup = this.effect(item.state?.effects);
          if (cleanup) {
            const existing = this.effects.get(item.path);
            this.effects.set(item.path, existing ? callAll(existing, cleanup) : cleanup);
          }
        });
        if (prevState === INIT_STATE) {
          this.action(machine.entry);
          const cleanup = this.effect(machine.effects);
          if (cleanup) {
            const existing = this.effects.get(INIT_STATE);
            this.effects.set(INIT_STATE, existing ? callAll(existing, cleanup) : cleanup);
          }
        }
        entering.forEach((item) => {
          this.action(item.state?.entry);
        });
      }
    }));
    this.state = state;
    this.cleanups.push(subscribe(this.state.ref, () => this.notify()));
  }
  updateProps(newProps) {
    const prevSource = this.userPropsRef.current;
    this.userPropsRef.current = () => {
      const prev = runIfFn(prevSource);
      const next = runIfFn(newProps);
      return mergeMachineProps(prev, next);
    };
    this.notify();
  }
  start() {
    this.status = MachineStatus.Started;
    this.debug("initializing...");
    this.state.invoke(this.state.initial, INIT_STATE);
    this.setupTrackers();
  }
  stop() {
    this.effects.forEach((fn) => fn?.());
    this.effects.clear();
    this.transition = null;
    this.action(this.machine.exit);
    this.cleanups.forEach((unsub) => unsub());
    this.cleanups = [];
    this.subscriptions = [];
    this.status = MachineStatus.Stopped;
    this.debug("unmounting...");
  }
  get service() {
    return {
      state: this.getState(),
      send: this.send,
      context: this.context,
      prop: this.prop,
      scope: this.scope,
      refs: this.refs,
      computed: this.computed,
      event: this.getEvent(),
      getStatus: () => this.status
    };
  }
};
export {
  VanillaMachine
};
