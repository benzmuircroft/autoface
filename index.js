const autoprune = async (options) => {
  return new Promise(async (resolve) => {
    const store = new Corestore(folder);
    await store.ready();
    let input = store.get({ name: 'input' });
    let output = store.get({ name: 'output' });
    await input.ready();
    await output.ready();
    let content;
    
    if (input.length > 100) {
      content = {};
      const all = output.createReadStream();
      let value;
      for await (const one of all) {
        value = one.value.toString();
        if (['[', '{'].includes(value[0])) {
          value = JSON.parse(value);
        }
        content[one.key.toString()] = value;
      }
      await input.purge();
      await output.purge();
      input = store.get({ name: 'input' });
      output = store.get({ name: 'output' });
      await input.ready();
      await output.ready();
      const b = new Hyperbee(input);
      const batch = b.batch();
      for await (const one of content) {
        await batch.put(one, content[one]);
      }
      await batch.flush();
    }

    base = new Autobase({
      inputs: [input],
      localInput: input,
      localOutput: output
    });
    base.start({
      unwrap: true,
      apply: async function(bee, batch) {
        const b = bee.batch({ update: false });
        for (const node of batch) {
          const op = JSON.parse(node.value.toString());
          if (op.type === 'del') await b.del(op.key); // not used
          else if (op.type === 'put') await b.put(op.key, op.value.toString());
        }
        await b.flush();
      },
      view: core => new Hyperbee(core.unwrap(), {
        extension: false
      })
    });
    await base.ready();
    const manager = new AutobaseManager(
      base,
      (key, coreType, channel) => true, // function to filter core keys
      store.get.bind(store), // get(key) function to get a hypercore given a key
      store.storage, // Storage for managing autobase keys
      { id: options.folderName } // Options
    );
    await manager.ready();

    const db = {
      get: async function(key) {
        await base.latest(base.inputs);
        await base.view.update({ wait: true });
        key = await base.view.get(key);
        if (!key) return key;
        key.value = key.value.toString();
        if (['[', '{'].includes(key.value[0])) return JSON.parse(key.value);
        return key.value;
      },
      put: async function(key, value) {
        const op = b4a.from(JSON.stringify({ type: 'put', key, value: JSON.stringify(value) }));
        await base.append(op);
        await base.view.update({ wait: true });
        await base.latest(base.inputs);
      }
    };
    
    resolve({ base, db });
  };
};

module.exports = autoprune;
