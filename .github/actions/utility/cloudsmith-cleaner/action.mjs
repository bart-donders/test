import prettyBytes from 'pretty-bytes';
import axios from 'axios';

export async function clean(options) {
	const cloudsmith = axios.create({
		baseURL: 'https://api.cloudsmith.io/v1/',
		headers: {
			'Content-Type': 'application/json',
			'X-Api-Key': options.cloudsmith_api_key
		}
	});

	const cloudsmithDocker = axios.create({
		baseURL: `${options.cloudsmith_docker_registry}/v2/`,
		headers: {
			'Accept': 'application/vnd.docker.distribution.manifest.list.v2+json',
			'Content-Type': 'application/json',
			'Authorization': `Basic ${Buffer.from(options.cloudsmith_username + ":" + options.cloudsmith_api_key).toString('base64')}`
		}
	})

	/**
	 * Fetches packages asynchronously by recursively retrieving new pages and concatenating them.
	 *
	 * @param query Filter query to send to cloudsmith, allows serverside filtering which speeds up fetching if wished.
	 * @param _page Hidden property to recursively increment the page number.
	 * @param _size Hidden property to internally change the fetch size.
	 * @returns {Promise<*>} Complete list of packages.
	 */
	const fetchPackages = async (query, _page = 1, _size = 500) => {
		console.log(`Fetching page ${_page}...`);

		const response = await cloudsmith.get(`packages/${options.repo_owner}/${options.repo_name}/?page=${_page}&page_size=${_size}&query=${query}`)
		const pages = parseInt(response.headers['x-pagination-pagetotal']);

		console.log(`Fetched page ${_page}/${pages}`)

		return _page !== pages ? response.data.concat(await fetchPackages(query, ++_page, _size)) : response.data;
	}

	/**
	 * Check a list of packages for completeness, to avoid undefined behavior in this script, should properties be missing or undefined.
	 * Throws an exception if a package is missing data; the API would be unreliable at that point.
	 * @param packages to check
	 */
	const packagesValidate = (packages) => {
		const validateFields = ['tags', 'name', 'format', 'status_str', 'uploaded_at', 'status_updated_at', 'identifier_perm', 'size', 'summary', 'version'];
		packages.forEach(pkg => {
			validateFields.forEach(f => {
				if (!pkg.hasOwnProperty(f) && pkg[f] === undefined) {
					throw `${JSON.stringify(pkg)}\n\n!!!! API IS UNSTABLE, UNABLE TO CONTINUE: package ${pkg.name} is missing or has undefined field: ${f} !!!!`
				}
			})
		})
	}

	/**
	 * Returns if a package is supported by the cleaner.
	 */
	const packageIsSupported = (pkg) => {
		/*
		 * The cleaner only supports manifest images, due to the inability to 100% safely determine which images are part of a manifest.
		 * Right now you can only determine whether an image of part of a manifest, by inspecting all manifests in the repo and then building a list of hashes and see if it contains the image.
		 * This is risky because, should this process fail, you'd have an incomplete list and will be deleting images that are part of a manifest.
		 * The only reliable way to do it is to not push non-manifest images, assume all images are part of a manifest, and then only deleting images while deleting a specific manifest.
		 */
		return (pkg.format === 'docker' && pkg.type_display === 'manifest/list')
			|| (pkg.format === 'docker' && pkg.type_display === 'image' && !pkg.parent && options.pkg_filter_process_dockerimage_without_parents)
			|| pkg.format === 'maven'
			|| pkg.format === 'npm'
			|| pkg.format === 'raw'
		        || pkg.format === 'nuget'; // Bart 16-05-2024: 'nuget' toegevoegd op advies van Leon Lieuw.
	}

	/**
	 * Returns the version of a package.
	 * Make sure the package is supported in the above method as well.
	 */
	const packageGetVersionTag = (pkg) => {
		if (pkg.format === 'docker' && pkg.type_display === 'manifest/list') {
			return pkg?.tags?.version?.[0];
		} else if (pkg.format === 'docker' && pkg.type_display === 'image' && !pkg.parent) {
			return pkg?.tags?.version?.[0];
		} else if (pkg.format === 'maven') {
			return pkg?.summary;
		} else if (pkg.format === 'npm') {
			return pkg?.version;
		} else if (pkg.format === 'raw') {
			return pkg?.tags?.version?.[0];
		} else if (pkg.format === 'nuget') {
			return pkg?.version;
		}
	}

	/**
	 * Filter a list of packages based on the global options -filter- criteria.
	 *
	 * @param packages packages to filter
	 * @returns {*} list of packages that match the global options filter criteria.
	 */
	const packagesFilter = (packages) => {
		return packages.filter(pkg => {
				// Filter on supported by script
				if (!packageIsSupported(pkg)) {
					console.log("FILTERED: unsupported: " + packageToString(pkg))
					return false;
				}

				// Filter on package name regex.
				if (!pkg.name.match(`${options.pkg_filter_name_regex}`)) {
					console.log("FILTERED: filter name regex not match: " + packageToString(pkg))
					return false;
				}

				// Filter on package format regex.
				if (!pkg.format.match(`${options.pkg_filter_format_regex}`)) {
					console.log("FILTERED: format regex not match: " + packageToString(pkg))
					return false;
				}

				// Check, should the package have a tag, whether it matches.
				if (packageGetVersionTag(pkg) && !packageGetVersionTag(pkg).match(`${options.pkg_filter_versiontag_regex}`)) {
					console.log("FILTERED: has tag but regex no match: " + packageToString(pkg))
					return false;
				}

				// Check, should the package has NO tag, whether we want to process missing items still
				if (!packageGetVersionTag(pkg) && !options.pkg_filter_versiontag_regex_allow_missing) {
					console.log("FILTERED: no tag and no allow missing: " + packageToString(pkg))
					return false;
				}

				// Check for days since upload
				const daysSinceUploaded = (Date.now() - Date.parse(pkg.uploaded_at)) / 86400 / 1000;
				if (packageGetVersionTag(pkg) && daysSinceUploaded < options.pkg_delete_versiontag_exists_after_days) {
					console.log("FILTERED: too young with tag: " + packageToString(pkg))
					return false;
				}

				if (!packageGetVersionTag(pkg) && daysSinceUploaded < options.pkg_delete_versiontag_missing_after_days) {
					console.log("FILTERED: too young without tag: " + packageToString(pkg))
					return false;
				}

				// Check if it's the latest package
				const packagesList = packages.filter(p => p.name === pkg.name);
				const isLatestPackage = packagesList.length === 1 ? true : packagesList.every(p => Date.parse(pkg.uploaded_at) >= Date.parse(p.uploaded_at));
				if (isLatestPackage) {
				    console.log("FILTERED: Latest package for: " + packageToString(pkg));
				    return false;
				}
			
				return true;
			}
		);
	}

	/**
	 * Return a string representation of a single package.
	 * @param pkg
	 * @returns string
	 */
	const packageToString = (pkg) => {
		return `[${pkg.format}|${pkg.type_display}][${pkg.identifier_perm}] ${pkg.name}:${packageGetVersionTag(pkg) || '?'} (uploaded: ${new Date(pkg.uploaded_at).toLocaleString('nl')})(${prettyBytes(pkg.size)})`;
	}

	/**
	 * Print a list of packages.
	 * @param packages
	 */
	const printPackages = (packages) => {
		packages?.forEach(pkg => {
			console.log(`\t${packageToString(pkg)}`);
			pkg.children?.forEach(child => console.log(`\t\t${packageToString(child)}`))
		})
	}

	/**
	 * Returns the size of a list of packages
	 * @param pkgs packages
	 * @returns {int} size in bytes
	 */
	function packagesGetSize(pkgs) {
		return pkgs.reduce((acc, pkg) => acc + pkg.size + packagesGetSize(pkg.children || []), 0)
	}

	/**
	 * Run the cloudsmith DELETE API call for these packages.
	 * @param packagesToDelete
	 * @returns {Promise<void>}
	 */
	const deletePackages = async (packagesToDelete) => {
		let err;

		for (const pkg of packagesToDelete) {
			await cloudsmith.delete(`packages/${options.repo_owner}/${options.repo_name}/${pkg.identifier_perm}/`)
				.then(response => {
					console.log(`Deleted: ${packageToString(pkg)}\n\t=> ${response.status}`);
				}).catch(response => {
					err = `${response.response.status}, ${JSON.stringify(response.response.data)}`;
					console.log(`Failed to delete package: ${packageToString(pkg)}\n\t\t=> ${err}`);
				});
			
			//Delete all children connected to this package
			if (pkg.children) {
				deletePackages(pkg.children);
			}
		}

		if (err) {
			throw err;
		}
	}


	async function getDigests(pkg, url) {
		const {data} = await cloudsmithDocker.get(url)
			.catch(error => {
				if (error.response === undefined || error.response.status !== 404) {
					console.log(error);
					throw error;
				} else {
					console.log(`Manifest data not found for: ${packageToString(pkg)}`);
					return {};
				}
			});

		if (data === undefined || data.manifests === undefined) {
			console.log(`Manifest contains no data for: ${packageToString(pkg)}`);
			return [];
		}

		return data.manifests.map(manifest => manifest.digest.replace('sha256:', ''));
	}

	async function packagesAddManifest(packages) {
		//Extract all the digests mentioned by the v2 manifests
		const dockerManifests = packages.filter(pkg => pkg.format === 'docker' && pkg.type_display === 'manifest/list');

		const chunkSize = 25;
		for (let i = 0; i < dockerManifests.length; i += chunkSize) {
			const manifestChunk = dockerManifests.slice(i, i + chunkSize);

			// Create a batch of requests
			const batch = new Map();
			for (const manifestPkg of manifestChunk) {
				batch.set(manifestPkg, getDigests(manifestPkg, `${manifestPkg.namespace}/${manifestPkg.repository}/${manifestPkg.name}/manifests/sha256:${manifestPkg.version}`));
			}

			// Process each batch of requests
			for (const [manifestPkg, manifestRequest] of batch) {
				const digests = await manifestRequest;
				manifestPkg.children = packages.filter(pkg => pkg.format === 'docker' && digests.includes(pkg.version));
				manifestPkg.children.forEach(pkg => pkg.parent = manifestPkg)
			}
		}
	}

	/**
	 * Main function of this module
	 **/
	async function run() {
		const packages = await fetchPackages(options.pkg_api_fetch_query);
		packagesValidate(packages);

		console.log(`Adding manifests for docker...`);
		await packagesAddManifest(packages);

		const packagesToDelete = packagesFilter(packages);
		console.log(`Packages to be deleted: ${packagesToDelete.length} (${prettyBytes(packagesGetSize(packagesToDelete))})`);
		printPackages(packagesToDelete);

		if (options.dry_run) {
			console.log('Aborting due to dry run.')
			return;
		}

		await deletePackages(packagesToDelete);

		console.log('Done!');
	}

	return await run();
}

export function Options() {
	this.dry_run = true;
	this.repo_name = '';
	this.repo_owner = '';
	this.pkg_api_fetch_query = '';
	this.pkg_filter_name_regex = '^.*$';
	this.pkg_filter_format_regex = '^.*$';
	this.pkg_filter_process_dockerimage_without_parents = false;
	this.pkg_filter_versiontag_regex = '^.+-SNAPSHOT$';
	this.pkg_filter_versiontag_regex_allow_missing = false;
	this.pkg_delete_versiontag_exists_after_days = 30;
	this.pkg_delete_versiontag_missing_after_days = 30;
	this.cloudsmith_username = '';
	this.cloudsmith_api_key = '';
	this.cloudsmith_docker_registry = '';

	this.print = () => {
		console.log("Options: ")
		console.log(`\tdry_run = ${this.dry_run}\n`);
		console.log(`\trepo_name = ${this.repo_name}`);
		console.log(`\trepo_owner = ${this.repo_owner}\n`);
		console.log(`\tpkg_api_fetch_query = ${this.pkg_api_fetch_query}\n`);
		console.log(`\tpkg_filter_name_regex = ${this.pkg_filter_name_regex}`);
		console.log(`\tpkg_filter_format_regex = ${this.pkg_filter_format_regex}`);
		console.log(`\tpkg_filter_process_dockerimage_without_parents = ${this.pkg_filter_process_dockerimage_without_parents}\n`);
		console.log(`\tpkg_filter_versiontag_regex = ${this.pkg_filter_versiontag_regex}`);
		console.log(`\tpkg_filter_versiontag_regex_allow_missing = ${this.pkg_filter_versiontag_regex_allow_missing}\n`);
		console.log(`\tpkg_delete_versiontag_exists_after_days = ${this.pkg_delete_versiontag_exists_after_days}`);
		console.log(`\tpkg_delete_versiontag_missing_after_days = ${this.pkg_delete_versiontag_missing_after_days}\n`);
		console.log(`\tcloudsmith_username = ${this.cloudsmith_username}\n`);
		console.log(`\tcloudsmith_api_key = ${this.cloudsmith_api_key}\n`);
		console.log(`\tcloudsmith_docker_registry = ${this.cloudsmith_docker_registry}\n`);
	}
}
