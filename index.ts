export type ErrorHandler = (error: any) => any;
export type Task<R, P> =
  | ((prevResult: P, ...args: any[]) => Promise<R>)
  | Promise<R>;

export type Queue<R, P> = {
  task: Task<R, P>;
  errorHandler: ErrorHandler | undefined;
};

export type ForeachArray<T, P> = ((prevResult: P) => T[]) | T[];

export type ForeachTask<R, T, P> = (
  item: T,
  prevResult: P,
  ...args: any[]
) => Promise<R>;

export type EndCallback<R, All> = (allResults: All) => R;

class Finalized<R> {
  #endPromise: Promise<R>;
  #defaultGuaranteedHandler: ErrorHandler | undefined;

  constructor(endPromise: Promise<R>, defaultGuaranteedHandler?: ErrorHandler) {
    this.#endPromise = endPromise;
    this.#defaultGuaranteedHandler =
      defaultGuaranteedHandler || ((error) => error);
  }

  async guarantee(
    guaranteedErrorHandler: ErrorHandler | "DEFAULT"
  ): Promise<R> {
    try {
      return await this.#endPromise;
    } catch (error) {
      if (guaranteedErrorHandler === "DEFAULT") {
        if (!this.#defaultGuaranteedHandler)
          throw Error(
            `You seem to want to use the default error handler, but you haven't set a default error handler.`
          );
        guaranteedErrorHandler = this.#defaultGuaranteedHandler;
      }
      return guaranteedErrorHandler(error);
    }
  }
}

class RequestSequencer<Tasks extends any[] = []> {
  #queue: Queue<any, any>[] = [];
  #errorHandler: ErrorHandler | undefined;
  #defaultGuaranteedErrorHandler: ErrorHandler | undefined;

  constructor(defaultGuaranteedErrorHandler?: ErrorHandler) {
    this.#defaultGuaranteedErrorHandler = defaultGuaranteedErrorHandler;
  }

  next<R = any, P = Tasks extends [...infer _, infer Last] ? Last : any>(
    task: Task<R, P>
  ): RequestSequencer<[...Tasks, R]> {
    this.#queue.push({ task, errorHandler: undefined });
    return this as any as RequestSequencer<[...Tasks, R]>;
  }

  catch(errorHandler: ErrorHandler): this {
    this.#queue[this.#queue.length - 1].errorHandler = errorHandler;
    return this;
  }

  foreach<
    R = any,
    T = any,
    P = Tasks extends [...infer _, infer Last] ? Last : any
  >(
    items: ForeachArray<T, P>,
    task: ForeachTask<R, T, P>
  ): RequestSequencer<[...Tasks, R[]]> {
    return this.next(async (prevResult: P) => {
      const resolvedItems =
        typeof items === "function" ? items(prevResult) : items;
      const results: R[] = [];
      for (const item of resolvedItems) {
        results.push(await task(item, prevResult));
      }
      return results;
    }) as RequestSequencer<[...Tasks, R[]]>;
  }

  end<R = any, All = Tasks>(callback: EndCallback<R, All>): Finalized<R> {
    const endPromise = (async () => {
      const results: R[] = [];
      try {
        let prevResult: any = null;
        for (const { task, errorHandler } of this.#queue) {
          this.#errorHandler = errorHandler;
          if (typeof task === "function") {
            prevResult = await task(prevResult);
          } else {
            prevResult = await task;
          }
          results.push(prevResult);
        }
        return callback(results as All);
      } catch (error) {
        if (this.#errorHandler) {
          return callback(this.#errorHandler(error));
        }
        throw error;
      }
    })();

    return new Finalized<R>(endPromise, this.#defaultGuaranteedErrorHandler);
  }
}

export { RequestSequencer };
export default RequestSequencer;
